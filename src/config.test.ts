import { expect, test } from 'vitest';

import { ConfigError, parseConfig } from './config.js';

const baseInputs = {
  'primary-model': 'claude-sonnet-5',
  'second-seat-model': '',
  'token-ceiling': '120000',
  'cost-ceiling-usd': '0.50',
  'blocking-disabled': '',
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
