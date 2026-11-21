import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type {
  CoachModel,
  Difficulty,
  EvaluatorModel,
  TextToSpeech,
  TranscriptLine,
} from '../ai/ai.types.js';
import { ClaudeCoach, ClaudeEvaluator } from '../ai/anthropic-providers.js';
import { evaluateChecked } from '../ai/evaluate-checked.js';
import {
  MockCoach,
  MockEvaluator,
  MockTextToSpeech,
} from '../ai/mock-providers.js';
import { OpenAiTextToSpeech } from '../ai/openai-providers.js';
import { isPriced, sttCostMicroUsd } from '../ai/pricing.js';
import {
  COACH_PLACEHOLDERS,
  EVALUATOR_PLACEHOLDERS,
  JUDGE_PLACEHOLDERS,
  loadPrompt,
} from '../ai/prompts.js';
import { AI_DEFAULTS } from '../config/env.js';
import {
  loadScenarioContent,
  scenarioContentPath,
  type Scenario,
} from '../scenarios/scenario-content.js';
import {
  count,
  isFabricationProblem,
  looksTurkish,
  median,
  percent,
  promptPhrases,
  scoreCorrection,
  scoreFollowUp,
  scoreStaysInRole,
  shareStatus,
  wordCount,
  type EvaluatorOutcome,
  type GoldenCorrection,
  type ItemResult,
  type TestResult,
  type TestStatus,
} from './scoring.js';

// The ten AI quality tests of docs/05-ai-kalite-testleri.md against the answer keys in
// evals/golden. `npm run eval` runs the mock providers (checks the runner, measures nothing);
// `npm run eval -- --live` calls Claude and OpenAI with the keys in apps/api/.env and costs money
// (about a dollar for the sample keys). The evaluator goes through the same server checks and
// retry as lessons (evaluateChecked).

export interface EvalOptions {
  live: boolean;
  /** Test numbers to run; all when empty. */
  only?: number[];
  /** At most this many items per answer key. */
  limit?: number;
  concurrency?: number;
  evalsDir?: string;
  /** Write the report to evals/results. */
  write?: boolean;
}

export interface EvalReport {
  startedAt: string;
  live: boolean;
  models: Record<string, string>;
  answerKeys: Record<string, string>;
  tests: TestResult[];
  spendMicroUsd: number;
  verdict: 'pass' | 'fail' | 'review';
  file?: string;
}

interface Key<T> {
  file: string;
  status: string;
  items: T[];
}

interface FollowUpItem {
  id: string;
  scenarioId: string;
  answer: string;
}

interface AdversarialItem {
  id: string;
  scenarioId: string;
  input: string;
}

interface TranscriptItem {
  id: string;
  scenarioId: string;
  transcript: TranscriptLine[];
}

const SECOND_ANSWER = "I think that's everything from my side. Thank you.";
const LATENCY_SAMPLES = 10;
const COST_LESSONS = 3;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

function message(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'error';
}

function providers(live: boolean) {
  const models = {
    coach: process.env.COACH_MODEL || AI_DEFAULTS.COACH_MODEL,
    evaluator: process.env.EVALUATOR_MODEL || AI_DEFAULTS.EVALUATOR_MODEL,
    stt: process.env.STT_MODEL || AI_DEFAULTS.STT_MODEL,
    tts: process.env.TTS_MODEL || AI_DEFAULTS.TTS_MODEL,
  };
  const coachPrompt = loadPrompt('coach', COACH_PLACEHOLDERS);
  if (!live) {
    return {
      models,
      coachPrompt,
      coach: new MockCoach() as CoachModel,
      evaluator: new MockEvaluator() as EvaluatorModel,
      tts: new MockTextToSpeech() as TextToSpeech,
    };
  }
  const missing = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'].filter(
    (key) => !process.env[key],
  );
  if (missing.length > 0) {
    throw new Error(`--live needs ${missing.join(' and ')} in apps/api/.env`);
  }
  for (const model of Object.values(models)) {
    if (!isPriced(model)) {
      throw new Error(`${model} has no price in src/ai/pricing.ts`);
    }
  }
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 2,
  });
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 2,
  });
  return {
    models,
    coachPrompt,
    coach: new ClaudeCoach(anthropic, models.coach, coachPrompt),
    evaluator: new ClaudeEvaluator(
      anthropic,
      models.evaluator,
      loadPrompt('evaluator', EVALUATOR_PLACEHOLDERS),
      loadPrompt('transfer-judge', JUDGE_PLACEHOLDERS),
    ),
    tts: new OpenAiTextToSpeech(
      openai,
      models.tts,
      process.env.TTS_VOICE || AI_DEFAULTS.TTS_VOICE,
    ),
  };
}

export async function runEvals(options: EvalOptions): Promise<EvalReport> {
  const startedAt = new Date().toISOString();
  const dir =
    options.evalsDir ??
    process.env.EVALS_DIR ??
    resolve(import.meta.dirname, '../../../../evals');
  const concurrency = options.concurrency ?? 4;
  const wanted = (test: number) =>
    !options.only?.length || options.only.includes(test);
  const { models, coachPrompt, coach, evaluator, tts } = providers(
    options.live,
  );
  const scenarios = new Map(
    loadScenarioContent(scenarioContentPath()).scenarios.map((s) => [s.id, s]),
  );
  const defaultScenario = [...scenarios.values()][0];
  const scenarioOf = (id?: string): Scenario =>
    (id && scenarios.get(id)) || defaultScenario;

  let spend = 0;
  const spent = (micro: number) => {
    spend += micro;
  };
  const answerKeys: Record<string, string> = {};
  const load = <T>(...names: string[]): Key<T> | null => {
    for (const name of names) {
      const path = join(dir, 'golden', name);
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as {
          status?: string;
          items: T[];
        };
        const items = options.limit
          ? raw.items.slice(0, options.limit)
          : raw.items;
        answerKeys[name] = raw.status ?? 'approved';
        return { file: name, status: raw.status ?? 'approved', items };
      }
    }
    return null;
  };

  const coachLine = async (
    scenario: Scenario,
    difficulty: Difficulty,
    transcript: TranscriptLine[],
    stage: 'ask_follow_up' | 'close' = 'ask_follow_up',
  ) => {
    const started = Date.now();
    const reply = await coach.reply({
      scenario,
      difficulty,
      transcript,
      stage,
    });
    spent(reply.usage.costMicroUsd);
    return { ...reply, ms: Date.now() - started };
  };

  const tests: TestResult[] = [];
  const noSet = (
    test: number,
    title: string,
    threshold: string,
    note: string,
  ) =>
    tests.push({
      test,
      title,
      status: 'no_set',
      measured: '—',
      threshold,
      note,
    });

  // Tests 1–4: the evaluator on the correction key (and the transcript key for test 3).
  const evaluatorOutcomes: (EvaluatorOutcome & { id: string })[] = [];
  let fabricationCaught = 0;
  const evaluate = async (
    id: string,
    scenario: Scenario,
    transcript: TranscriptLine[],
  ) => {
    const learnerLines = transcript
      .filter((t) => t.speaker === 'learner')
      .map((t) => t.text);
    try {
      const result = await evaluateChecked(
        evaluator,
        { scenario, transcript },
        learnerLines,
        ({ usage, problems }) => {
          spent(usage.costMicroUsd);
          fabricationCaught += problems.filter(isFabricationProblem).length;
        },
      );
      const outcome = {
        id,
        draft: result.draft,
        problems: result.problems,
      };
      evaluatorOutcomes.push(outcome);
      return outcome;
    } catch (error) {
      const outcome = { id, problems: [], error: message(error) };
      evaluatorOutcomes.push(outcome);
      return outcome;
    }
  };

  if ([1, 2, 3, 4].some(wanted)) {
    const key = load<GoldenCorrection>(
      'corrections.json',
      'corrections.sample.json',
    );
    if (!key) {
      noSet(
        1,
        'Düzeltme doğruluğu',
        '≥ %90',
        'evals/golden/corrections.json yok',
      );
      noSet(2, 'Yanlış alarm', '≤ %5', 'evals/golden/corrections.json yok');
    } else {
      const scored = await mapLimit(key.items, concurrency, async (item) => {
        const scenario = scenarioOf(item.scenarioId);
        const outcome = await evaluate(item.id, scenario, [
          { speaker: 'coach', text: scenario.opening },
          { speaker: 'learner', text: item.input },
        ]);
        return { item, result: scoreCorrection(item, outcome) };
      });
      const draftNote =
        key.status === 'approved'
          ? undefined
          : `cevap anahtarı taslak (${key.file}): eğitmen onayı yok`;
      const wrong = scored.filter((s) => s.item.hasError).map((s) => s.result);
      const right = scored.filter((s) => !s.item.hasError).map((s) => s.result);
      if (wanted(1)) {
        tests.push({
          test: 1,
          title: 'Düzeltme doğruluğu',
          status: shareStatus(wrong, 0.9),
          measured: `${count(wrong, 'pass')}/${wrong.length} doğru (${percent(count(wrong, 'pass'), wrong.length)}), ${count(wrong, 'review')} incelemede`,
          threshold: '≥ %90',
          note: draftNote,
          items: wrong,
        });
      }
      if (wanted(2)) {
        const alarms = count(right, 'fail');
        tests.push({
          test: 2,
          title: 'Yanlış alarm',
          status:
            right.length === 0
              ? 'review'
              : alarms / right.length <= 0.05
                ? 'pass'
                : 'fail',
          measured: `${alarms}/${right.length} doğru cümleye hata dendi (${percent(alarms, right.length)})`,
          threshold: '≤ %5',
          note: draftNote,
          items: right,
        });
      }
    }

    if (wanted(3) || wanted(4)) {
      const transcripts = load<TranscriptItem>('transcripts.json');
      if (transcripts) {
        await mapLimit(transcripts.items, concurrency, (item) =>
          evaluate(item.id, scenarioOf(item.scenarioId), item.transcript),
        );
      }
      if (wanted(3)) {
        // Numbers and padding are caught by the server checks and never reach the learner;
        // a fact added in words needs a person to read the pairs below.
        const shown = evaluatorOutcomes.filter(
          (o) =>
            o.draft && o.problems.length === 0 && o.draft.kind === 'correction',
        );
        tests.push({
          test: 3,
          title: 'Uydurma yok',
          status: shown.length === 0 ? 'no_set' : 'review',
          measured: `sunucu denetimi ${fabricationCaught} kez sayı ya da uzunluk ekini yakaladı; ${shown.length} gösterilen düzeltme okunacak`,
          threshold: 'sıfır uydurma',
          note: transcripts
            ? undefined
            : 'evals/golden/transcripts.json (20 döküm) yok; düzeltme setinin çıktıları kullanıldı',
          items: shown.map((o) => ({
            id: o.id,
            status: 'review' as const,
            original: o.draft!.original,
            improved: o.draft!.improved,
          })),
        });
      }
      if (wanted(4)) {
        const items: ItemResult[] = evaluatorOutcomes.map((o) => {
          if (o.error || !o.draft) {
            return { id: o.id, status: 'fail', reason: o.error ?? 'no answer' };
          }
          if (o.problems.length > 0) {
            return {
              id: o.id,
              status: 'fail',
              reason: `no correction shown: ${o.problems.join(' ')}`,
            };
          }
          if (!looksTurkish(o.draft.explanationTr)) {
            return {
              id: o.id,
              status: 'fail',
              reason: 'explanation not in Turkish',
              explanationTr: o.draft.explanationTr,
            };
          }
          return { id: o.id, status: 'pass' };
        });
        const failed = count(items, 'fail');
        tests.push({
          test: 4,
          title: 'Tek düzeltme kuralı',
          status:
            items.length === 0 ? 'no_set' : failed === 0 ? 'pass' : 'fail',
          measured: `${items.length - failed}/${items.length} derste tek, kurala uyan düzeltme`,
          threshold: 'her derste tam bir; açıklama en fazla iki Türkçe cümle',
          items,
        });
      }
    }
  }

  // Tests 5, 6, 9 and 10: the coach on the follow-up key.
  if ([5, 6, 9, 10].some(wanted)) {
    const key = load<FollowUpItem>('followups.json');
    if (!key) {
      for (const [test, title, threshold] of [
        [5, 'Takip sorusu', '≥ 18/20'],
        [6, 'Seviye uyumu', 'kolayda ort. < 12 kelime'],
        [9, 'Gecikme', 'ortanca < 3 sn'],
        [10, 'Maliyet', 'ders başına < 0,10 $'],
      ] as const) {
        if (wanted(test))
          noSet(test, title, threshold, 'evals/golden/followups.json yok');
      }
    } else {
      const easy = await mapLimit(key.items, concurrency, async (item) => {
        const scenario = scenarioOf(item.scenarioId);
        try {
          const reply = await coachLine(scenario, 'easy', [
            { speaker: 'coach', text: scenario.opening },
            { speaker: 'learner', text: item.answer },
          ]);
          return { item, reply };
        } catch (error) {
          return { item, error: message(error) };
        }
      });

      if (wanted(5)) {
        const items = easy.map(({ item, reply, error }) =>
          reply
            ? scoreFollowUp(item.id, item.answer, reply.text)
            : ({ id: item.id, status: 'fail', reason: error } as ItemResult),
        );
        tests.push({
          test: 5,
          title: 'Takip sorusu',
          status: shareStatus(items, 0.9),
          measured: `${count(items, 'pass')}/${items.length} cevaba dayanıyor, ${count(items, 'review')} incelemede`,
          threshold: '≥ %90 (20 örnekte 18)',
          items,
        });
      }

      if (wanted(6)) {
        const hard = await mapLimit(key.items, concurrency, async (item) => {
          const scenario = scenarioOf(item.scenarioId);
          try {
            return await coachLine(scenario, 'hard', [
              { speaker: 'coach', text: scenario.opening },
              { speaker: 'learner', text: item.answer },
            ]);
          } catch {
            return null;
          }
        });
        const easyWords = easy
          .filter((e) => e.reply)
          .map((e) => wordCount(e.reply!.text));
        const average =
          easyWords.reduce((a, b) => a + b, 0) / Math.max(1, easyWords.length);
        const hints = hard.filter((h) => h?.move === 'hint').length;
        tests.push({
          test: 6,
          title: 'Seviye uyumu',
          status: average < 12 && hints === 0 ? 'pass' : 'fail',
          measured: `kolayda ortalama ${average.toFixed(1)} kelime; zorda ${hints} ipucu`,
          threshold: 'kolayda ortalama < 12 kelime; zorda ipucu yok',
        });
      }

      if (wanted(9)) {
        const samples = easy.filter((e) => e.reply).slice(0, LATENCY_SAMPLES);
        const latencies = await mapLimit(samples, 2, async ({ reply }) => {
          const started = Date.now();
          try {
            const audio = await tts.synthesize(reply!.text, {
              difficulty: 'easy',
            });
            spent(audio.costMicroUsd);
            return reply!.ms + (Date.now() - started);
          } catch {
            return Number.POSITIVE_INFINITY;
          }
        });
        const value = median(latencies);
        tests.push({
          test: 9,
          title: 'Gecikme',
          status:
            latencies.length === 0 ? 'no_set' : value < 3000 ? 'pass' : 'fail',
          measured: `ortanca ${(value / 1000).toFixed(2)} sn (${latencies.length} örnek)`,
          threshold: 'ortanca < 3 sn',
          note: 'koç ve seslendirme süresi; döküm süresi ses seti gelince eklenecek',
        });
      }

      if (wanted(10)) {
        // A whole lesson: spoken opening, two answers with replies, one evaluation, and speech
        // to text for two 15-second answers (estimated from the price list).
        const lessons = await mapLimit(
          key.items.slice(0, COST_LESSONS),
          concurrency,
          async (item) => {
            const scenario = scenarioOf(item.scenarioId);
            let cost = sttCostMicroUsd(models.stt, 30_000);
            const add = (micro: number) => {
              cost += micro;
              spent(micro);
            };
            try {
              add(
                (await tts.synthesize(scenario.opening, { difficulty: 'easy' }))
                  .costMicroUsd,
              );
              const transcript: TranscriptLine[] = [
                { speaker: 'coach', text: scenario.opening },
                { speaker: 'learner', text: item.answer },
              ];
              const first = await coach.reply({
                scenario,
                difficulty: 'easy',
                transcript,
                stage: 'ask_follow_up',
              });
              add(first.usage.costMicroUsd);
              add(
                (await tts.synthesize(first.text, { difficulty: 'easy' }))
                  .costMicroUsd,
              );
              transcript.push(
                { speaker: 'coach', text: first.text },
                { speaker: 'learner', text: SECOND_ANSWER },
              );
              const closing = await coach.reply({
                scenario,
                difficulty: 'easy',
                transcript,
                stage: 'close',
              });
              add(closing.usage.costMicroUsd);
              add(
                (await tts.synthesize(closing.text, { difficulty: 'easy' }))
                  .costMicroUsd,
              );
              transcript.push({ speaker: 'coach', text: closing.text });
              await evaluateChecked(
                evaluator,
                { scenario, transcript },
                [item.answer, SECOND_ANSWER],
                ({ usage }) => add(usage.costMicroUsd),
              );
              return cost;
            } catch {
              return null;
            }
          },
        );
        const done = lessons.filter((c): c is number => c !== null);
        const average =
          done.reduce((a, b) => a + b, 0) / Math.max(1, done.length);
        tests.push({
          test: 10,
          title: 'Maliyet',
          status:
            done.length === 0 ? 'fail' : average < 100_000 ? 'pass' : 'fail',
          measured: `ders başına ortalama ${(average / 1_000_000).toFixed(4)} $ (${done.length} ders)`,
          threshold: 'ders başına < 0,10 $',
        });
      }
    }
  }

  if (wanted(7)) {
    noSet(
      7,
      'Tanıma hatası ayrımı',
      'döküm kaynaklı düzeltme en fazla 1',
      'evals/golden/audio (Türk aksanlı 20 kayıt ve doğru dökümleri) yok',
    );
  }

  if (wanted(8)) {
    const key = load<AdversarialItem>('adversarial.json');
    if (!key) {
      noSet(
        8,
        'Rolde kalma',
        '15 girdinin hepsi',
        'evals/golden/adversarial.json yok',
      );
    } else {
      const items = await mapLimit(key.items, concurrency, async (item) => {
        const scenario = scenarioOf(item.scenarioId);
        const phrases = promptPhrases(
          coachPrompt.render({
            coachRole: scenario.coachRole,
            situationTr: scenario.situationTr,
            skillEn: scenario.skillEn,
            difficulty: 'easy',
          }),
        );
        try {
          const reply = await coachLine(scenario, 'easy', [
            { speaker: 'coach', text: scenario.opening },
            { speaker: 'learner', text: item.input },
          ]);
          return scoreStaysInRole(item.id, item.input, reply.text, phrases);
        } catch (error) {
          // A refusal is not a failure to stay in role, but the learner sees an error.
          return {
            id: item.id,
            status: 'review',
            reason: message(error),
          } as ItemResult;
        }
      });
      const failed = count(items, 'fail');
      tests.push({
        test: 8,
        title: 'Rolde kalma',
        status:
          failed > 0 ? 'fail' : count(items, 'review') > 0 ? 'review' : 'pass',
        measured: `${count(items, 'pass')}/${items.length} rolde kaldı, ${failed} çıktı`,
        threshold: 'hepsi rolde; uygunsuz içerik yok',
        items,
      });
    }
  }

  tests.sort((a, b) => a.test - b.test);
  const statuses = new Set<TestStatus>(tests.map((t) => t.status));
  const verdict = statuses.has('fail')
    ? 'fail'
    : statuses.has('review') || statuses.has('no_set')
      ? 'review'
      : 'pass';
  const report: EvalReport = {
    startedAt,
    live: options.live,
    models,
    answerKeys,
    tests,
    spendMicroUsd: spend,
    verdict,
  };
  if (options.write) {
    const out = join(dir, 'results');
    mkdirSync(out, { recursive: true });
    const file = join(
      out,
      `${startedAt.replace(/[:.]/g, '-')}-${options.live ? 'live' : 'mock'}.json`,
    );
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    report.file = file;
  }
  return report;
}

const LABEL: Record<TestStatus, string> = {
  pass: 'GEÇTİ',
  fail: 'KALDI',
  review: 'İNCELEME',
  no_set: 'SET YOK',
};

export function formatReport(report: EvalReport): string {
  const lines = [
    `AI kalite testleri (${report.live ? 'gerçek modeller' : 'sahte AI: yalnızca çalıştırıcıyı dener, kalite ölçmez'})`,
    `Modeller: koç ${report.models.coach}, değerlendirici ${report.models.evaluator}, seslendirme ${report.models.tts}`,
    '',
    '| Test | Durum | Ölçülen | Eşik |',
    '| --- | --- | --- | --- |',
    ...report.tests.map(
      (t) =>
        `| ${t.test}. ${t.title} | ${LABEL[t.status]} | ${t.measured}${t.note ? ` (${t.note})` : ''} | ${t.threshold} |`,
    ),
    '',
    `Harcama: ${(report.spendMicroUsd / 1_000_000).toFixed(4)} $`,
    `Sonuç: ${report.verdict === 'pass' ? 'GEÇTİ' : report.verdict === 'fail' ? 'KALDI (sürüm çıkmaz)' : 'İNCELEME GEREKİYOR'}`,
  ];
  if (report.file) {
    lines.push(`Ayrıntı: ${report.file}`);
  }
  return lines.join('\n');
}

function parseArgs(argv: string[]): EvalOptions {
  const value = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const only = value('only');
  const limit = value('limit');
  const concurrency = value('concurrency');
  return {
    live: argv.includes('--live'),
    only: only ? only.split(',').map(Number) : undefined,
    limit: limit ? Number(limit) : undefined,
    concurrency: concurrency ? Number(concurrency) : undefined,
    write: true,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runEvals(options);
  console.log(formatReport(report));
  // A release does not go out while a measured test is below its threshold.
  if (options.live && report.verdict === 'fail') {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
