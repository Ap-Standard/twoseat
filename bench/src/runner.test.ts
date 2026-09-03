import { expect, test } from 'vitest';

import { FINDINGS_TOOL_NAME } from '../../src/findings/model.js';
import type { SeatOutcome, SeatRequest } from '../../src/seats/anthropic.js';
import type { BenchCase } from './case.js';
import { runCase, runCorpus, type RunnerDeps } from './runner.js';

const benchCase: BenchCase = {
  id: 'sql-001',
  kind: 'defect',
  category: 'sql-injection',
  description: 'A user-supplied id is interpolated into a template literal query.',
  files: [
    {
      path: 'src/repo/users.ts',
      patch: [
        '@@ -12,4 +12,4 @@',
        ' async findById(id: string) {',
        "-  return db.query('SELECT * FROM users WHERE id = $1', [id]);",
        '+  return db.query(`SELECT * FROM users WHERE id = ${id}`);',
        ' }',
      ].join('\n'),
    },
  ],
  expected: [
    { path: 'src/repo/users.ts', line: 14, severity: 'P1', category: 'sql-injection' },
  ],
};

function seatReturning(outcome: SeatOutcome) {
  const calls: SeatRequest[] = [];
  const seat = (request: SeatRequest): Promise<SeatOutcome> => {
    calls.push(request);
    return Promise.resolve(outcome);
  };
  return { seat, calls };
}

function deps(seat: RunnerDeps['seat'], overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  let clock = 0;
  return {
    seat,
    now: () => (clock += 250),
    apiKey: 'test-key-not-a-real-credential',
    model: 'test-model',
    tokenCeiling: 120_000,
    prices: { inputPerMTok: 3, outputPerMTok: 15 },
    ...overrides,
  };
}

const foundIt: SeatOutcome = {
  kind: 'ok',
  toolInput: {
    findings: [
      {
        path: 'src/repo/users.ts',
        line: 14,
        severity: 'P1',
        confidence: 'high',
        category: 'sql-injection',
        title: 'query built by interpolation',
        detail: 'The id is interpolated rather than bound.',
      },
    ],
  },
  usage: { inputTokens: 900, outputTokens: 120 },
};

test('sends the case diff to the seat', async () => {
  const { seat, calls } = seatReturning(foundIt);

  await runCase(benchCase, deps(seat));

  expect(calls[0]?.data).toContain('SELECT * FROM users WHERE id = ${id}');
});

test('never puts the case description in the prompt', async () => {
  // Answer leakage. The description names the defect in plain English, and a
  // seat handed that is not being measured on anything.
  const { seat, calls } = seatReturning(foundIt);

  await runCase(benchCase, deps(seat));

  const sent = `${calls[0]?.instructions ?? ''}\n${calls[0]?.data ?? ''}`;
  expect(sent).not.toContain('interpolated into a template literal');
  expect(sent).not.toContain(benchCase.description);
});

test('never puts the expected findings in the prompt', async () => {
  const { seat, calls } = seatReturning(foundIt);

  await runCase(benchCase, deps(seat));

  const sent = `${calls[0]?.instructions ?? ''}\n${calls[0]?.data ?? ''}`;
  expect(sent).not.toContain('sql-injection');
  expect(sent).not.toMatch(/expected/i);
});

test('never puts the case id or kind in the prompt', async () => {
  const { seat, calls } = seatReturning(foundIt);

  await runCase(benchCase, deps(seat));

  const sent = `${calls[0]?.instructions ?? ''}\n${calls[0]?.data ?? ''}`;
  expect(sent).not.toContain('sql-001');
});

test('returns the findings the gate would publish, attributed to the seat', async () => {
  const { seat } = seatReturning(foundIt);

  const result = await runCase(benchCase, deps(seat));

  expect(result.reviewed).toBe(true);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.model).toBe('test-model');
  expect(result.findings[0]?.line).toBe(14);
});

test('scores the gate rather than the raw model, so an unanchored finding is dropped', async () => {
  // The benchmark measures what a reviewer sees. A finding the action would
  // reject never reaches a comment, so it must not count as a hit here either.
  const { seat } = seatReturning({
    kind: 'ok',
    toolInput: {
      findings: [
        {
          path: 'src/repo/users.ts',
          line: 900,
          severity: 'P1',
          confidence: 'high',
          category: 'sql-injection',
          title: 'somewhere else entirely',
          detail: 'anchored outside the diff',
        },
      ],
    },
    usage: { inputTokens: 10, outputTokens: 10 },
  });

  const result = await runCase(benchCase, deps(seat));

  expect(result.findings).toEqual([]);
});

test('records a seat failure as a case that was not reviewed', async () => {
  const { seat } = seatReturning({ kind: 'failed', message: 'seat API returned 429' });

  const result = await runCase(benchCase, deps(seat));

  expect(result.reviewed).toBe(false);
  expect(result.notReviewedReason).toContain('429');
  expect(result.findings).toEqual([]);
});

test('records a reply that is not a findings list as not reviewed', async () => {
  const { seat } = seatReturning({
    kind: 'ok',
    toolInput: { note: 'looks fine' },
    usage: { inputTokens: 10, outputTokens: 5 },
  });

  const result = await runCase(benchCase, deps(seat));

  expect(result.reviewed).toBe(false);
});

test('measures latency from the clock it was given', async () => {
  const { seat } = seatReturning(foundIt);

  const result = await runCase(benchCase, deps(seat));

  expect(result.latencyMs).toBe(250);
});

test('prices the run from reported usage', async () => {
  const { seat } = seatReturning(foundIt);

  const result = await runCase(benchCase, deps(seat));

  // 900 input at $3/Mtok plus 120 output at $15/Mtok.
  expect(result.costUsd).toBeCloseTo(900e-6 * 3 + 120e-6 * 15, 12);
});

test('leaves cost unset when no prices were supplied', async () => {
  const { seat } = seatReturning(foundIt);

  const result = await runCase(benchCase, deps(seat, { prices: null }));

  expect(result.costUsd).toBeNull();
});

test('mints a fresh marker token per case, so one diff cannot learn another\'s', async () => {
  const { seat, calls } = seatReturning(foundIt);

  await runCase(benchCase, deps(seat));
  await runCase(benchCase, deps(seat));

  expect(calls[0]?.data).not.toBe(calls[1]?.data);
});

test('runs every case the requested number of times', async () => {
  const { seat, calls } = seatReturning(foundIt);

  const results = await runCorpus([benchCase, benchCase], deps(seat), 3);

  expect(calls).toHaveLength(6);
  expect(results).toHaveLength(6);
});

test('forces the findings tool on every call', async () => {
  const { seat, calls } = seatReturning(foundIt);

  await runCase(benchCase, deps(seat));

  expect(calls[0]?.instructions).toContain(FINDINGS_TOOL_NAME);
});

test('does not score a case whose labeled file the budget withheld', async () => {
  // Validation checks a label against the files the run sent, but scoring
  // compares against every label on the case. A budget that withholds the
  // labeled file would turn its label into a miss the seat could never have
  // avoided, since it never saw the file.
  const { seat } = seatReturning(foundIt);
  const twoFiles: BenchCase = {
    ...benchCase,
    files: [
      ...benchCase.files,
      { path: 'dist/bundle.js', patch: '@@ -1,1 +1,2 @@\n+generated\n+output\n' },
    ],
    expected: [
      ...benchCase.expected,
      { path: 'dist/bundle.js', line: 1, severity: 'P1', category: 'other' },
    ],
  };

  const result = await runCase(twoFiles, deps(seat));

  expect(result.reviewed).toBe(false);
  expect(result.notReviewedReason).toMatch(/withheld/i);
});

test('does not score a case the budget emptied entirely', async () => {
  // The production gate reports an empty plan as a review that did not run.
  // The harness has to agree, or a ceiling too small to fit anything would
  // score as a seat that missed every defect.
  const { seat, calls } = seatReturning(foundIt);

  const result = await runCase(benchCase, deps(seat, { tokenCeiling: 1 }));

  expect(calls).toHaveLength(0);
  expect(result.reviewed).toBe(false);
});
