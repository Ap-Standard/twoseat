/**
 * Action inputs, validated once at startup.
 *
 * Configuration problems are raised here rather than mid-run, so a misconfigured
 * workflow fails with a readable message instead of a partial review.
 */

import type { TokenPrices } from './cost.js';
import { CONFIDENCES, type Confidence } from './findings/model.js';

/**
 * The threshold a P1 finding must reach to produce a blocking decision.
 *
 * Calibrated against the corpus in bench/, and the reasoning is in
 * docs/degrade-policy.md rather than here. `low` is dominated: no P1 finding in
 * the run carried it. `high` exempts an entire defect class the seat was less
 * confident about and right about every time.
 */
export const DEFAULT_BLOCKING_CONFIDENCE: Confidence = 'medium';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface Config {
  primaryModel: string;
  /** Null when no second seat is configured, which is a valid single-seat run. */
  secondSeatModel: string | null;
  /**
   * Null when the run has no key. A pull request from a fork gets no repository
   * secrets, so this is an expected state and not a configuration error.
   */
  apiKey: string | null;
  tokenCeiling: number;
  costCeilingUsd: number;
  /** Null when the workflow supplied no rates, which means no cost estimate. */
  tokenPrices: TokenPrices | null;
  blockingDisabled: boolean;
  /** Why blocking is off, for the run log and the PR comment. Null when on. */
  blockingDisabledReason: string | null;
  /** Threshold a P1 must reach to block. Findings are counted against it either way. */
  blockingConfidence: Confidence;
}

export type InputReader = (name: string) => string;

const TRUTHY = new Set(['true', '1', 'yes', 'on']);
const FALSY = new Set(['false', '0', 'no', 'off']);

function requireNonEmpty(name: string, raw: string): string {
  const value = raw.trim();
  if (value === '') {
    throw new ConfigError(`Input "${name}" is required.`);
  }
  return value;
}

function requirePositiveNumber(name: string, raw: string): number {
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`Input "${name}" must be a positive number, got "${raw}".`);
  }
  return value;
}

function requirePositiveInteger(name: string, raw: string): number {
  const value = requirePositiveNumber(name, raw);
  if (!Number.isInteger(value)) {
    throw new ConfigError(`Input "${name}" must be a whole number, got "${raw}".`);
  }
  return value;
}

interface KillSwitch {
  blockingDisabled: boolean;
  blockingDisabledReason: string | null;
}

/**
 * Resolves the kill switch.
 *
 * An unrecognized value disables blocking. A value the action cannot interpret
 * is a malfunction of the gate, and the published policy is that the gate never
 * blocks on its own malfunction. Failing the other way would let a typo in a
 * repository variable block every pull request in the repo.
 */
function resolveKillSwitch(raw: string): KillSwitch {
  const value = raw.trim().toLowerCase();

  if (value === '') {
    return { blockingDisabled: false, blockingDisabledReason: null };
  }
  if (TRUTHY.has(value)) {
    return {
      blockingDisabled: true,
      blockingDisabledReason: 'the kill switch is set',
    };
  }
  if (FALSY.has(value)) {
    return { blockingDisabled: false, blockingDisabledReason: null };
  }

  return {
    blockingDisabled: true,
    blockingDisabledReason:
      `unrecognized kill-switch value ${JSON.stringify(raw)}; ` +
      'blocking is disabled because the gate does not guess at its own configuration',
  };
}

/**
 * Resolves the blocking policy: the kill switch and the confidence threshold.
 *
 * An unrecognized threshold disables blocking, for the same reason an
 * unrecognized kill-switch value does. It still resolves to the default so the
 * `blocking-findings` count stays meaningful, since the count is a measurement
 * and only the decision is switched off.
 *
 * A kill switch that is already set keeps its own reason. It is the more direct
 * explanation of why blocking is off, and it is the one an operator just set.
 */
function resolveBlockingPolicy(read: InputReader): KillSwitch & { blockingConfidence: Confidence } {
  const killSwitch = resolveKillSwitch(read('blocking-disabled'));
  const raw = read('blocking-confidence');
  const value = raw.trim().toLowerCase();

  if (value === '') {
    return { ...killSwitch, blockingConfidence: DEFAULT_BLOCKING_CONFIDENCE };
  }

  if ((CONFIDENCES as readonly string[]).includes(value)) {
    return { ...killSwitch, blockingConfidence: value as Confidence };
  }

  return {
    blockingDisabled: true,
    blockingDisabledReason:
      killSwitch.blockingDisabledReason ??
      `unrecognized blocking-confidence value ${JSON.stringify(raw)}; ` +
        'blocking is disabled because the gate does not guess at its own configuration',
    blockingConfidence: DEFAULT_BLOCKING_CONFIDENCE,
  };
}

function requireRate(name: string, raw: string): number {
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0) {
    throw new ConfigError(`Input "${name}" must be zero or a positive number, got "${raw}".`);
  }
  return value;
}

/**
 * Resolves token prices.
 *
 * Both rates or neither. Half a pair would produce a cost figure that is wrong
 * rather than absent, and a wrong number is worse than a missing one in a
 * comment and in a benchmark.
 */
function resolveTokenPrices(read: InputReader): TokenPrices | null {
  const rawInput = read('input-price-per-mtok').trim();
  const rawOutput = read('output-price-per-mtok').trim();

  if (rawInput === '' && rawOutput === '') {
    return null;
  }
  if (rawInput === '' || rawOutput === '') {
    throw new ConfigError(
      'Inputs "input-price-per-mtok" and "output-price-per-mtok" must be set together. ' +
        'One rate alone would price a run incorrectly.',
    );
  }

  return {
    inputPerMTok: requireRate('input-price-per-mtok', rawInput),
    outputPerMTok: requireRate('output-price-per-mtok', rawOutput),
  };
}

export function parseConfig(read: InputReader): Config {
  const secondSeatModel = read('second-seat-model').trim();
  const apiKey = read('api-key').trim();

  return {
    primaryModel: requireNonEmpty('primary-model', read('primary-model')),
    secondSeatModel: secondSeatModel === '' ? null : secondSeatModel,
    apiKey: apiKey === '' ? null : apiKey,
    tokenCeiling: requirePositiveInteger('token-ceiling', read('token-ceiling')),
    costCeilingUsd: requirePositiveNumber('cost-ceiling-usd', read('cost-ceiling-usd')),
    tokenPrices: resolveTokenPrices(read),
    ...resolveBlockingPolicy(read),
  };
}
