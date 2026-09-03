import { expect, test } from 'vitest';

import { estimateCostUsd, worstCaseCostUsd, type TokenPrices } from './cost.js';

const prices: TokenPrices = { inputPerMTok: 3, outputPerMTok: 15 };

test('prices input and output tokens separately and sums them', () => {
  const estimate = estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 100_000 }, prices);

  expect(estimate.usd).toBeCloseTo(4.5, 10);
});

test('names both rates, so the figure carries the method that produced it', () => {
  const { basis } = estimateCostUsd({ inputTokens: 10, outputTokens: 10 }, prices);

  expect(basis).toContain('3.00');
  expect(basis).toContain('15.00');
  expect(basis).toMatch(/per million tokens/);
});

test('costs a run that used nothing at zero', () => {
  expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0 }, prices).usd).toBe(0);
});

test('treats a usage figure the API did not report as zero rather than as NaN', () => {
  const estimate = estimateCostUsd({ inputTokens: Number.NaN, outputTokens: -5 }, prices);

  expect(estimate.usd).toBe(0);
});

test('charges the full output budget when estimating a run before it happens', () => {
  // The ceiling can only cap spend if the estimate assumes the worst the seat
  // is allowed to do, so the pre-flight bills the entire output allowance.
  expect(worstCaseCostUsd({ inputTokens: 1_000_000, maxOutputTokens: 1_000_000 }, prices)).toBeCloseTo(
    18,
    10,
  );
});
