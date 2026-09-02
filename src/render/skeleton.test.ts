import { expect, test } from 'vitest';

import type { Config } from '../config.js';
import type { BudgetPlan } from '../ingest/budget.js';
import { COMMENT_MARKER } from './comment.js';
import { renderSkeletonBody } from './skeleton.js';

const config: Config = {
  primaryModel: 'claude-sonnet-5',
  secondSeatModel: null,
  tokenCeiling: 120_000,
  costCeilingUsd: 0.5,
  blockingDisabled: false,
  blockingDisabledReason: null,
};

const plan: BudgetPlan = {
  included: [{ path: 'src/app.ts', patch: 'xxx', chars: 3 }],
  dropped: [{ path: 'package-lock.json', reason: 'generated', chars: 10_000 }],
  charBudget: 100,
  charsUsed: 3,
};

test('embeds the marker so re-runs update one comment instead of appending', () => {
  expect(renderSkeletonBody({ config, plan })).toContain(COMMENT_MARKER);
});

test('lists what the run dropped, with the reason', () => {
  const body = renderSkeletonBody({ config, plan });

  expect(body).toContain('package-lock.json');
  expect(body).toContain('generated');
});

test('states that no model review has run yet, so the comment is not mistaken for one', () => {
  expect(renderSkeletonBody({ config, plan })).toMatch(/no model review/i);
});

test('reports why blocking is off when the kill switch is set', () => {
  const body = renderSkeletonBody({
    config: { ...config, blockingDisabled: true, blockingDisabledReason: 'the kill switch is set' },
    plan,
  });

  expect(body).toMatch(/kill switch is set/);
});

test('names the second seat as not configured for a single-seat run', () => {
  expect(renderSkeletonBody({ config, plan })).toMatch(/not configured/i);
});
