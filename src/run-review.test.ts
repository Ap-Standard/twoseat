import { expect, test } from 'vitest';

import type { Config } from './config.js';
import { FINDINGS_TOOL_NAME } from './findings/model.js';
import type { BudgetPlan } from './ingest/budget.js';
import { assembleReviewPrompt } from './prompt/assemble.js';
import { runReview } from './run-review.js';
import type { SeatOutcome, SeatRequest } from './seats/anthropic.js';

const config: Config = {
  primaryModel: 'test-model',
  secondSeatModel: null,
  apiKey: 'test-key-not-a-real-credential',
  tokenCeiling: 120_000,
  costCeilingUsd: 0.5,
  tokenPrices: { inputPerMTok: 3, outputPerMTok: 15 },
  blockingDisabled: false,
  blockingDisabledReason: null,
};

const plan: BudgetPlan = {
  included: [{ path: 'src/app.ts', patch: '@@ -1,1 +1,3 @@\n+a\n+b\n', chars: 24 }],
  dropped: [],
  charBudget: 336_000,
  charsUsed: 24,
};

const emptyPlan: BudgetPlan = { included: [], dropped: [], charBudget: 336_000, charsUsed: 0 };

const prompt = assembleReviewPrompt({ plan, nonce: 'deadbeefcafe0001' });

function seatReturning(outcome: SeatOutcome) {
  const calls: SeatRequest[] = [];
  const seat = (request: SeatRequest): Promise<SeatOutcome> => {
    calls.push(request);
    return Promise.resolve(outcome);
  };
  return { seat, calls };
}

const oneFinding: SeatOutcome = {
  kind: 'ok',
  toolInput: {
    findings: [
      {
        path: 'src/app.ts',
        line: 2,
        severity: 'P1',
        confidence: 'high',
        title: 'unawaited write',
        detail: 'A failure is dropped.',
      },
    ],
  },
  usage: { inputTokens: 1_000, outputTokens: 200 },
};

test('spends nothing when the diff has no reviewable file', async () => {
  const { seat, calls } = seatReturning(oneFinding);

  const outcome = await runReview(config, emptyPlan, prompt, seat);

  expect(calls).toHaveLength(0);
  expect(outcome.kind).toBe('not-reviewed');
});

test('reports the missing key instead of calling a seat without one', async () => {
  const { seat, calls } = seatReturning(oneFinding);

  const outcome = await runReview({ ...config, apiKey: null }, plan, prompt, seat);

  expect(calls).toHaveLength(0);
  expect(outcome.kind === 'not-reviewed' && outcome.reason).toMatch(/fork/i);
});

test('refuses a run whose worst case would break the cost ceiling', async () => {
  // Checked before the call. A ceiling enforced after the money is spent is
  // not a ceiling.
  const { seat, calls } = seatReturning(oneFinding);

  const outcome = await runReview({ ...config, costCeilingUsd: 0.0001 }, plan, prompt, seat);

  expect(calls).toHaveLength(0);
  expect(outcome.kind === 'not-reviewed' && outcome.reason).toMatch(/ceiling/i);
  expect(outcome.kind === 'not-reviewed' && outcome.reason).toContain('0.0001');
});

test('runs when no prices are configured, since there is no dollar ceiling to break', async () => {
  const { seat, calls } = seatReturning(oneFinding);

  const outcome = await runReview({ ...config, tokenPrices: null }, plan, prompt, seat);

  expect(calls).toHaveLength(1);
  expect(outcome.kind).toBe('reviewed');
  expect(outcome.kind === 'reviewed' && outcome.cost).toBeNull();
});

test('carries a seat failure into the outcome rather than throwing', async () => {
  const { seat } = seatReturning({ kind: 'failed', message: 'seat API returned 429: slow down' });

  const outcome = await runReview(config, plan, prompt, seat);

  expect(outcome.kind).toBe('not-reviewed');
  expect(outcome.kind === 'not-reviewed' && outcome.reason).toContain('429');
});

test('sends the assembled prompt and the response allowance to the seat', async () => {
  const { seat, calls } = seatReturning(oneFinding);

  await runReview(config, plan, prompt, seat);

  expect(calls[0]?.instructions).toBe(prompt.instructions);
  expect(calls[0]?.data).toBe(prompt.data);
  expect(calls[0]?.model).toBe('test-model');
  expect(calls[0]?.maxOutputTokens).toBe(12_000);
});

test('attributes a validated finding to the seat and prices the run', async () => {
  const { seat } = seatReturning(oneFinding);

  const outcome = await runReview(config, plan, prompt, seat);

  expect(outcome.kind === 'reviewed' && outcome.findings).toEqual([
    {
      seat: 'primary',
      model: 'test-model',
      path: 'src/app.ts',
      line: 2,
      severity: 'P1',
      confidence: 'high',
      title: 'unawaited write',
      detail: 'A failure is dropped.',
    },
  ]);
  expect(outcome.kind === 'reviewed' && outcome.cost?.usd).toBeCloseTo(0.006, 10);
});

test('keeps a rejected finding out of the findings and counts it instead', async () => {
  const { seat } = seatReturning({
    kind: 'ok',
    toolInput: {
      findings: [
        {
          path: 'src/invented.ts',
          line: 1,
          severity: 'P1',
          confidence: 'high',
          title: 'made up',
          detail: 'about a file the run never sent',
        },
      ],
    },
    usage: { inputTokens: 10, outputTokens: 10 },
  });

  const outcome = await runReview(config, plan, prompt, seat);

  expect(outcome.kind === 'reviewed' && outcome.findings).toEqual([]);
  expect(outcome.kind === 'reviewed' && outcome.rejected).toEqual([
    { reason: 'unknown-file', path: 'src/invented.ts' },
  ]);
});

test('treats a payload that is not a findings list as a review that did not run', async () => {
  // The worst rendering available: zero findings plus one rejection reads as a
  // clean review with a footnote. A reply the action could not parse has to
  // report that nothing reviewed the diff.
  for (const toolInput of [{}, { findings: 'approved' }, 'ship it', null]) {
    const { seat } = seatReturning({
      kind: 'ok',
      toolInput,
      usage: { inputTokens: 10, outputTokens: 10 },
    });

    const outcome = await runReview(config, plan, prompt, seat);

    expect(outcome.kind).toBe('not-reviewed');
    expect(outcome.kind === 'not-reviewed' && outcome.reason).toMatch(/could not be read|not a/i);
  }
});

test('treats a reply the seat could not shape as a review that did not run', async () => {
  // The seat layer reports an unparseable reply as a failure. This asserts the
  // composition keeps it that way rather than turning it into a clean review.
  const { seat } = seatReturning({
    kind: 'failed',
    message: `seat replied without calling the ${FINDINGS_TOOL_NAME} tool`,
  });

  expect((await runReview(config, plan, prompt, seat)).kind).toBe('not-reviewed');
});
