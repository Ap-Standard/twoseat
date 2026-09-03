/**
 * Action inputs, validated once at startup.
 *
 * Configuration problems are raised here rather than mid-run, so a misconfigured
 * workflow fails with a readable message instead of a partial review.
 */

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
  tokenCeiling: number;
  costCeilingUsd: number;
  blockingDisabled: boolean;
  /** Why blocking is off, for the run log and the PR comment. Null when on. */
  blockingDisabledReason: string | null;
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

export function parseConfig(read: InputReader): Config {
  const secondSeatModel = read('second-seat-model').trim();

  return {
    primaryModel: requireNonEmpty('primary-model', read('primary-model')),
    secondSeatModel: secondSeatModel === '' ? null : secondSeatModel,
    tokenCeiling: requirePositiveInteger('token-ceiling', read('token-ceiling')),
    costCeilingUsd: requirePositiveNumber('cost-ceiling-usd', read('cost-ceiling-usd')),
    ...resolveKillSwitch(read('blocking-disabled')),
  };
}
