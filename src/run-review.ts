/**
 * Deciding whether to review, and what the result was.
 *
 * Split out from the entry point so it can be tested with an injected seat: the
 * composition is where a degrade path goes wrong, and a module that self-runs
 * on import cannot be tested at all.
 *
 * Every path returns an outcome and nothing here throws, so the caller always
 * has something honest to put in the comment. The one result this function
 * must never produce is a clean review for a run that did not happen.
 */
import type { Config } from './config.js';
import { estimateCostUsd, worstCaseCostUsd } from './cost.js';
import { parseSeatFindings } from './findings/parse.js';
import { estimateTokensFromChars, outputTokenBudget, type BudgetPlan } from './ingest/budget.js';
import type { AssembledPrompt } from './prompt/assemble.js';
import type { ReviewOutcome } from './render/review.js';
import { callSeat, type SeatOutcome, type SeatRequest } from './seats/anthropic.js';

/** The label this seat carries into every finding it reports. */
export const PRIMARY_SEAT = 'primary';

export type SeatCaller = (request: SeatRequest) => Promise<SeatOutcome>;

export async function runReview(
  config: Config,
  plan: BudgetPlan,
  prompt: AssembledPrompt,
  seat: SeatCaller = callSeat,
): Promise<ReviewOutcome> {
  if (plan.included.length === 0) {
    return { kind: 'not-reviewed', reason: 'This diff contains no file the gate can review.' };
  }

  if (config.apiKey === null) {
    // Expected on a pull request from a fork: those runs get no repository
    // secrets. It is a state to report, not an error to raise.
    return {
      kind: 'not-reviewed',
      reason: 'No API key reached this run, which is the expected state for a fork.',
    };
  }

  const maxOutputTokens = outputTokenBudget(config.tokenCeiling);

  if (config.tokenPrices !== null) {
    const inputTokens = estimateTokensFromChars(prompt.instructions.length + prompt.data.length);
    const worstCase = worstCaseCostUsd({ inputTokens, maxOutputTokens }, config.tokenPrices);

    if (worstCase > config.costCeilingUsd) {
      return {
        kind: 'not-reviewed',
        reason:
          'Skipped to stay inside the cost ceiling. This run could have cost up to ' +
          `$${worstCase.toFixed(4)} against a ceiling of $${config.costCeilingUsd.toFixed(4)}.`,
      };
    }
  }

  const outcome = await seat({
    apiKey: config.apiKey,
    model: config.primaryModel,
    instructions: prompt.instructions,
    data: prompt.data,
    maxOutputTokens,
  });

  if (outcome.kind === 'failed') {
    return { kind: 'not-reviewed', reason: outcome.message };
  }

  const { findings, rejected } = parseSeatFindings(outcome.toolInput, {
    seat: PRIMARY_SEAT,
    model: config.primaryModel,
    files: plan.included,
  });

  return {
    kind: 'reviewed',
    findings,
    rejected,
    usage: outcome.usage,
    cost: config.tokenPrices === null ? null : estimateCostUsd(outcome.usage, config.tokenPrices),
  };
}
