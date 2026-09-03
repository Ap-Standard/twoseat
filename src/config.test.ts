import { expect, test } from 'vitest';

import { ConfigError, parseConfig } from './config.js';

const baseInputs = {
  'primary-model': 'claude-sonnet-5',
  'second-seat-model': '',
  'token-ceiling': '120000',
  'cost-ceiling-usd': '0.50',
  'blocking-disabled': '',
  'api-key': '',
  'input-price-per-mtok': '',
  'output-price-per-mtok': '',
};

function reader(overrides: Partial<typeof baseInputs> = {}) {
  const inputs: Record<string, string> = { ...baseInputs, ...overrides };
  return (name: string): string => inputs[name] ?? '';
}

test('an empty second-seat model means a single-seat run', () => {
  expect(parseConfig(reader()).secondSeatModel).toBeNull();
});

test('rejects a cost ceiling that is not a positive number', () => {
  expect(() => parseConfig(reader({ 'cost-ceiling-usd': 'cheap' }))).toThrow(ConfigError);
  expect(() => parseConfig(reader({ 'cost-ceiling-usd': '0' }))).toThrow(ConfigError);
  expect(() => parseConfig(reader({ 'cost-ceiling-usd': '-1' }))).toThrow(ConfigError);
});

test('an unset kill switch leaves blocking enabled', () => {
  const config = parseConfig(reader({ 'blocking-disabled': '' }));

  expect(config.blockingDisabled).toBe(false);
  expect(config.blockingDisabledReason).toBeNull();
});

test('an unrecognized kill-switch value disables blocking rather than guessing', () => {
  const config = parseConfig(reader({ 'blocking-disabled': 'mabye' }));

  expect(config.blockingDisabled).toBe(true);
  expect(config.blockingDisabledReason).toMatch(/unrecognized/i);
});

test('recognizes the documented kill-switch spellings regardless of case', () => {
  for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
    expect(parseConfig(reader({ 'blocking-disabled': value })).blockingDisabled).toBe(true);
  }
  for (const value of ['false', 'FALSE', '0', 'no', 'off']) {
    expect(parseConfig(reader({ 'blocking-disabled': value })).blockingDisabled).toBe(false);
  }
});

test('unset token prices mean no cost estimate rather than a guessed one', () => {
  expect(parseConfig(reader()).tokenPrices).toBeNull();
});

test('reads both token prices when the workflow supplies them', () => {
  const config = parseConfig(
    reader({ 'input-price-per-mtok': '3', 'output-price-per-mtok': '15' }),
  );

  expect(config.tokenPrices).toEqual({ inputPerMTok: 3, outputPerMTok: 15 });
});

test('rejects half a price pair, which would estimate a run at the wrong cost', () => {
  expect(() => parseConfig(reader({ 'input-price-per-mtok': '3' }))).toThrow(ConfigError);
  expect(() => parseConfig(reader({ 'output-price-per-mtok': '15' }))).toThrow(ConfigError);
});

test('rejects a token price that is not a number', () => {
  const inputs = { 'input-price-per-mtok': 'three', 'output-price-per-mtok': '15' };

  expect(() => parseConfig(reader(inputs))).toThrow(ConfigError);
});

test('allows a zero token price, which is what a free-tier rate is', () => {
  const config = parseConfig(
    reader({ 'input-price-per-mtok': '0', 'output-price-per-mtok': '0' }),
  );

  expect(config.tokenPrices).toEqual({ inputPerMTok: 0, outputPerMTok: 0 });
});

test('an absent api key is a valid single-run state, not a configuration error', () => {
  // A pull request from a fork gets no repository secrets. The gate has to
  // report that it could not review rather than fail the check.
  expect(parseConfig(reader()).apiKey).toBeNull();
});
