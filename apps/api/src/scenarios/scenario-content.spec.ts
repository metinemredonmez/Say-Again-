import { join } from 'node:path';
import { loadScenarioContent, parseScenarioContent, scenarioContentPath, type ScenarioContent } from './scenario-content.js';

describe('scenario content', () => {
  const real = (): ScenarioContent => structuredClone(loadScenarioContent(scenarioContentPath()));

  it('loads the real content file', () => {
    const content = real();
    expect(content.packs.map((p) => p.id)).toEqual(['professional', 'seller']);
    expect(content.scenarios).toHaveLength(20);
    expect(content.scenarios.filter((s) => s.pack === 'professional')).toHaveLength(12);
    expect(content.scenarios.filter((s) => s.pack === 'seller')).toHaveLength(8);
    expect(new Set(content.scenarios.map((s) => s.targetLanguage))).toEqual(new Set(['en']));
  });

  it('rejects a duplicate scenario id', () => {
    const content = real();
    content.scenarios[1].id = content.scenarios[0].id;
    expect(() => parseScenarioContent(content)).toThrow(/duplicate scenario id/);
  });

  it('rejects a scenario that points to an unknown pack', () => {
    const content = real();
    content.scenarios[0].pack = 'teacher';
    expect(() => parseScenarioContent(content)).toThrow(/unknown pack "teacher"/);
  });

  it('rejects a transfer question that repeats the opening question', () => {
    const content = real();
    content.scenarios[0].transfer.question = content.scenarios[0].opening;
    expect(() => parseScenarioContent(content)).toThrow(/transfer question must differ/);
  });

  it('rejects unknown fields and missing fields', () => {
    const extra = real() as unknown as { scenarios: Record<string, unknown>[] };
    extra.scenarios[0].answerKey = 'leaked';
    expect(() => parseScenarioContent(extra)).toThrow(/Unrecognized key/);

    const missing = real() as unknown as { scenarios: Record<string, unknown>[] };
    delete missing.scenarios[0].transfer;
    expect(() => parseScenarioContent(missing)).toThrow(/transfer/);
  });

  it('rejects a target language that is not an ISO 639-1 code', () => {
    const content = real();
    content.scenarios[0].targetLanguage = 'english';
    expect(() => parseScenarioContent(content)).toThrow(/ISO 639-1/);
  });

  it('fails with a clear error when the file is missing', () => {
    expect(() => loadScenarioContent(join(import.meta.dirname, 'missing.json'))).toThrow(
      /Cannot read scenario content/,
    );
  });
});
