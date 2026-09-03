import { expect, test } from 'vitest';

import type { Config } from '../config.js';
import type { Finding } from '../findings/model.js';
import type { BudgetPlan } from '../ingest/budget.js';
import { PROMPT_VERSION } from '../prompt/assemble.js';
import { COMMENT_MARKER } from './comment.js';
import { renderReviewBody, type ReviewCommentInput } from './review.js';

const config: Config = {
  primaryModel: 'claude-sonnet-5',
  secondSeatModel: null,
  apiKey: 'test-key-not-a-real-credential',
  tokenCeiling: 120_000,
  costCeilingUsd: 0.5,
  tokenPrices: { inputPerMTok: 3, outputPerMTok: 15 },
  blockingDisabled: false,
  blockingDisabledReason: null,
};

const plan: BudgetPlan = {
  included: [{ path: 'src/app.ts', patch: '@@ -1,1 +1,2 @@\n+x\n', chars: 20 }],
  dropped: [{ path: 'package-lock.json', reason: 'generated', chars: 10_000 }],
  charBudget: 336_000,
  charsUsed: 20,
};

const finding: Finding = {
  seat: 'primary',
  model: 'claude-sonnet-5',
  path: 'src/app.ts',
  line: 2,
  severity: 'P1',
  confidence: 'high',
  title: 'unawaited write',
  detail: 'The write is never awaited, so a failure is dropped.',
};

const reviewed: ReviewCommentInput = {
  config,
  plan,
  promptVersion: PROMPT_VERSION,
  outcome: {
    kind: 'reviewed',
    findings: [finding],
    rejected: [],
    usage: { inputTokens: 12_345, outputTokens: 678 },
    cost: { usd: 0.047, basis: 'at $3.00 in and $15.00 out per million tokens' },
  },
};

test('embeds the marker so re-runs update one comment instead of appending', () => {
  expect(renderReviewBody(reviewed)).toContain(COMMENT_MARKER);
});

test('anchors a finding to a file and line, with its severity', () => {
  const body = renderReviewBody(reviewed);

  expect(body).toContain('P1');
  expect(body).toContain('src/app.ts:2');
  expect(body).toContain('unawaited write');
});

test('attributes a finding to the seat that reported it', () => {
  // Attribution is the point of two seats. A finding with no seat on it cannot
  // be scored per seat, and disagreement between seats disappears.
  const body = renderReviewBody(reviewed);

  expect(body).toMatch(/confidence high/i);
  expect(body).toMatch(/primary seat/i);
});

test('counts findings by severity in the headline', () => {
  const body = renderReviewBody({
    ...reviewed,
    outcome: {
      ...reviewed.outcome,
      kind: 'reviewed',
      findings: [finding, { ...finding, line: 1, severity: 'P2', title: 'naming' }],
      rejected: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: null,
    },
  });

  expect(body).toMatch(/1 P1/);
  expect(body).toMatch(/1 P2/);
});

test('neutralizes seat prose, so a finding cannot notify anyone from the comment', () => {
  const body = renderReviewBody({
    ...reviewed,
    outcome: {
      kind: 'reviewed',
      findings: [{ ...finding, detail: 'ask @octocat to approve <img src="http://x.invalid">' }],
      rejected: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: null,
    },
  });

  expect(body).not.toContain('@octocat');
  expect(body).not.toContain('<img');
});

test('strips a backtick from a path, so it cannot break out of a code span', () => {
  const body = renderReviewBody({
    ...reviewed,
    outcome: {
      kind: 'reviewed',
      findings: [{ ...finding, path: 'src/we`ird.ts' }],
      rejected: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: null,
    },
  });

  expect(body).toContain('src/weird.ts:2');
});

test('says a clean review found nothing, which is a result and not an absence', () => {
  const body = renderReviewBody({
    ...reviewed,
    outcome: {
      kind: 'reviewed',
      findings: [],
      rejected: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: null,
    },
  });

  expect(body).toMatch(/no findings/i);
});

test('never claims a clean review when the seat did not answer', () => {
  // The most damaging possible rendering. A failed run that looks clean tells a
  // reviewer the diff was checked when nothing checked it.
  const body = renderReviewBody({
    ...reviewed,
    outcome: { kind: 'not-reviewed', reason: 'seat API returned 429: rate limited' },
  });

  expect(body).not.toMatch(/no findings/i);
  expect(body).toMatch(/did not run/i);
  expect(body).toContain('429');
});

test('reports the token counts the run actually used', () => {
  const body = renderReviewBody(reviewed);

  expect(body).toContain('12,345');
  expect(body).toContain('678');
});

test('states the method beside the cost figure', () => {
  const body = renderReviewBody(reviewed);

  expect(body).toContain('$0.0470');
  expect(body).toContain('per million tokens');
});

test('says the dollar ceiling is unenforced when the workflow supplied no prices', () => {
  const body = renderReviewBody({
    ...reviewed,
    config: { ...config, tokenPrices: null },
    outcome: {
      kind: 'reviewed',
      findings: [],
      rejected: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: null,
    },
  });

  expect(body).toMatch(/no token prices/i);
  expect(body).toMatch(/not enforced/i);
});

test('lists what the run withheld, with the reason', () => {
  const body = renderReviewBody(reviewed);

  expect(body).toContain('package-lock.json');
  expect(body).toContain('generated');
});

test('counts discarded seat output by reason, so a drop is never silent', () => {
  const body = renderReviewBody({
    ...reviewed,
    outcome: {
      kind: 'reviewed',
      findings: [],
      rejected: [
        { reason: 'unanchored-line', path: 'src/app.ts' },
        { reason: 'unanchored-line', path: 'src/app.ts' },
        { reason: 'unknown-file', path: 'src/invented.ts' },
      ],
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: null,
    },
  });

  expect(body).toMatch(/2 anchored to a line outside the diff/i);
  expect(body).toMatch(/1 named a file the run did not send/i);
});

test('reports the prompt version, so a comment can be traced to a prompt', () => {
  expect(renderReviewBody({ ...reviewed, promptVersion: '7' })).toContain('| 7 |');
});

test('reports why blocking is off when the kill switch is set', () => {
  const body = renderReviewBody({
    ...reviewed,
    config: { ...config, blockingDisabled: true, blockingDisabledReason: 'the kill switch is set' },
  });

  expect(body).toMatch(/kill switch is set/);
});

test('names the second seat as not configured for a single-seat run', () => {
  expect(renderReviewBody(reviewed)).toMatch(/not configured/i);
});

test('redacts the api key from a finding that quotes it', () => {
  // The ugly case, and the likely one: a diff commits a credential, the seat
  // correctly reports it, and the gate posts the credential to a public
  // comment. core.setSecret masks the run log and does nothing for a comment.
  const key = config.apiKey ?? '';
  const body = renderReviewBody({
    ...reviewed,
    outcome: {
      kind: 'reviewed',
      findings: [
        { ...finding, title: `hardcoded key ${key}`, detail: `remove ${key} from line 2` },
      ],
      rejected: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: null,
    },
  });

  expect(body).not.toContain(key);
  expect(body).toContain('(redacted)');
});

test('redacts the api key from the reason a review did not run', () => {
  const key = config.apiKey ?? '';
  const body = renderReviewBody({
    ...reviewed,
    outcome: { kind: 'not-reviewed', reason: `seat API rejected key ${key}` },
  });

  expect(body).not.toContain(key);
});

test('never puts the api key in an ordinary comment either', () => {
  expect(renderReviewBody(reviewed)).not.toContain(config.apiKey);
});
