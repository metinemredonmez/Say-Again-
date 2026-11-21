import { formatReport, runEvals } from './run.js';

// The runner end to end on the mock providers: no keys, no network, no cost. The mock evaluator
// only knows one mistake, so this checks the plumbing and the scoring, not AI quality.
describe('runEvals (mock providers)', () => {
  it('runs all ten tests against the answer keys in evals/golden', async () => {
    const report = await runEvals({ live: false });

    expect(report.tests.map((t) => t.test)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    const test = (n: number) => report.tests.find((t) => t.test === n)!;

    // The mock corrects only "I am working here since three years." (e02), the expected way.
    expect(test(1).items?.find((i) => i.id === 'e02')?.status).toBe('pass');
    expect(test(1).status).toBe('fail');
    expect(test(1).note).toMatch(/taslak/);
    // It calls every correct sentence correct: no false alarms.
    expect(test(2).status).toBe('pass');
    expect(test(4).status).toBe('pass');
    // The mock coach asks the scenario's written follow-up, always in role.
    expect(test(8).status).toBe('pass');
    expect(test(7).status).toBe('no_set');
    expect(test(10).status).toBe('pass');
    expect(report.spendMicroUsd).toBe(0);
    expect(report.verdict).toBe('fail');
    expect(report.answerKeys).toHaveProperty('corrections.sample.json');
  });

  it('runs only the tests asked for, and prints a table', async () => {
    const report = await runEvals({ live: false, only: [2, 8], limit: 3 });
    expect(report.tests.map((t) => t.test)).toEqual([2, 8]);
    expect(report.tests[1].items).toHaveLength(3);
    const text = formatReport(report);
    expect(text).toContain('| 8. Rolde kalma | GEÇTİ |');
    expect(text).toContain('sahte AI');
  });

  it('refuses a live run without keys', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(runEvals({ live: true })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  });
});
