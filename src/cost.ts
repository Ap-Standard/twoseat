/**
 * Cost estimation.
 *
 * Token prices arrive as workflow inputs rather than living in a table here.
 * Published prices change, and a rate baked into this repository would go stale
 * without anyone noticing, which would put an unmethodical number in a comment
 * and in the benchmark. Supplying the rate at the call site keeps every figure
 * traceable to a rate the caller stated.
 *
 * Without configured rates the action reports token counts and says plainly
 * that no cost estimate is available. It never guesses a price.
 */

export interface TokenPrices {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface CostEstimate {
  usd: number;
  /** How the figure was produced, carried into the comment alongside it. */
  basis: string;
}

const PER_MILLION = 1_000_000;

/** An absent or nonsensical count is worth nothing, not NaN. */
function tokens(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function describeRates(prices: TokenPrices): string {
  return (
    `at $${prices.inputPerMTok.toFixed(2)} in and ` +
    `$${prices.outputPerMTok.toFixed(2)} out per million tokens, ` +
    'from the rates this workflow supplied'
  );
}

export function estimateCostUsd(usage: Usage, prices: TokenPrices): CostEstimate {
  const usd =
    (tokens(usage.inputTokens) * prices.inputPerMTok) / PER_MILLION +
    (tokens(usage.outputTokens) * prices.outputPerMTok) / PER_MILLION;

  return { usd, basis: describeRates(prices) };
}

export interface WorstCase {
  inputTokens: number;
  maxOutputTokens: number;
}

/**
 * Upper bound on what a run may cost, used before the call is made.
 *
 * It bills the entire output allowance rather than a likely response length. A
 * ceiling checked against an optimistic estimate is not a ceiling.
 */
export function worstCaseCostUsd(worstCase: WorstCase, prices: TokenPrices): number {
  return estimateCostUsd(
    { inputTokens: worstCase.inputTokens, outputTokens: worstCase.maxOutputTokens },
    prices,
  ).usd;
}
