/**
 * Running the corpus through the gate.
 *
 * The benchmark measures **the gate, not the raw model**. A case goes through
 * the same budget, the same prompt assembly, and the same output validation
 * the action applies to a real pull request, so a finding the action would
 * reject does not count as a hit here either. A reviewer never sees it, and a
 * score that counted it would be measuring something nobody experiences.
 *
 * Only the case's diff reaches a seat. The description names the defect in
 * plain English and the labels give its location, so either one in the prompt
 * would be an answer key and the measurement would be worthless. Tests assert
 * their absence rather than trusting the code to be careful.
 */
import { estimateCostUsd, type TokenPrices } from '../../src/cost.js';
import { isFindingsPayload, parseSeatFindings } from '../../src/findings/parse.js';
import {
  charBudgetForTokens,
  outputTokenBudget,
  planDiffBudget,
  type DiffFile,
} from '../../src/ingest/budget.js';
import { assembleReviewPrompt, createRunNonce } from '../../src/prompt/assemble.js';
import { PRIMARY_SEAT } from '../../src/run-review.js';
import { callSeat, type SeatOutcome, type SeatRequest } from '../../src/seats/anthropic.js';
import type { BenchCase } from './case.js';
import type { CaseRun } from './score.js';

export type SeatCaller = (request: SeatRequest) => Promise<SeatOutcome>;

export interface RunnerDeps {
  seat: SeatCaller;
  /** Injected so latency is measurable without a real clock in tests. */
  now: () => number;
  apiKey: string;
  model: string;
  tokenCeiling: number;
  prices: TokenPrices | null;
}

/**
 * Presents a case as the pull request files API would.
 *
 * Additions and deletions are counted from the patch rather than declared, so
 * a case cannot describe itself inconsistently.
 */
function toDiffFiles(benchCase: BenchCase): DiffFile[] {
  return benchCase.files.map((file) => {
    const lines = file.patch.split('\n');
    return {
      path: file.path,
      status: 'modified' as const,
      additions: lines.filter((line) => line.startsWith('+')).length,
      deletions: lines.filter((line) => line.startsWith('-')).length,
      patch: file.patch,
    };
  });
}

export async function runCase(benchCase: BenchCase, deps: RunnerDeps): Promise<CaseRun> {
  const plan = planDiffBudget(toDiffFiles(benchCase), {
    charBudget: charBudgetForTokens(deps.tokenCeiling),
  });

  const notScorable = (reason: string): CaseRun => ({
    benchCase,
    findings: [],
    reviewed: false,
    notReviewedReason: reason,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: deps.prices === null ? null : 0,
    latencyMs: 0,
  });

  // Mirrors the gate, which reports an empty plan as a review that did not
  // run. Scoring it instead would read a ceiling too small to fit anything as
  // a seat that missed every defect.
  if (plan.included.length === 0) {
    return notScorable('the diff budget left no file to review');
  }

  // A label on a file the budget withheld cannot be scored fairly: the seat
  // never saw that file, so its label would become a miss nothing could avoid.
  const withheld = benchCase.expected
    .map((label) => label.path)
    .filter((path) => !plan.included.some((file) => file.path === path));

  if (withheld.length > 0) {
    return notScorable(
      `the diff budget withheld a labeled file: ${[...new Set(withheld)].join(', ')}`,
    );
  }

  // A fresh token per case, exactly as a real run mints one. A shared token
  // would let one case's diff carry a delimiter another case could forge.
  const prompt = assembleReviewPrompt({ plan, nonce: createRunNonce() });

  const startedAt = deps.now();
  const outcome = await deps.seat({
    apiKey: deps.apiKey,
    model: deps.model,
    instructions: prompt.instructions,
    data: prompt.data,
    maxOutputTokens: outputTokenBudget(deps.tokenCeiling),
  });
  const latencyMs = deps.now() - startedAt;

  const notReviewed = (reason: string, usage = { inputTokens: 0, outputTokens: 0 }): CaseRun => ({
    benchCase,
    findings: [],
    reviewed: false,
    notReviewedReason: reason,
    usage,
    costUsd: deps.prices === null ? null : estimateCostUsd(usage, deps.prices).usd,
    latencyMs,
  });

  if (outcome.kind === 'failed') {
    return notReviewed(outcome.message);
  }

  if (!isFindingsPayload(outcome.toolInput)) {
    return notReviewed("the seat's reply could not be read as a findings list", outcome.usage);
  }

  const { findings } = parseSeatFindings(outcome.toolInput, {
    seat: PRIMARY_SEAT,
    model: deps.model,
    files: plan.included,
  });

  return {
    benchCase,
    findings,
    reviewed: true,
    usage: outcome.usage,
    costUsd: deps.prices === null ? null : estimateCostUsd(outcome.usage, deps.prices).usd,
    latencyMs,
  };
}

export interface RunOptions {
  runsPerCase?: number;
  /**
   * Give up after this many cases in a row fail to reach a seat.
   *
   * A bad key, a wrong model id, or a malformed request fails every case
   * identically. Finding that out on case 48 costs 48 calls and tells you
   * nothing that case 3 did not. Zero disables the check.
   */
  abortAfterConsecutiveFailures?: number;
  /** Run one case by id, for diagnosing without paying for the whole corpus. */
  only?: string;
  onCase?: (result: CaseRun, done: number, total: number) => void;
}

/**
 * Runs the corpus, one case at a time.
 *
 * Sequential on purpose. Concurrency would invite rate limiting, and rate
 * limiting shows up as cases that did not reach a seat, which is a worse
 * outcome than a slower run.
 */
export async function runCorpus(
  cases: readonly BenchCase[],
  deps: RunnerDeps,
  options: RunOptions = {},
): Promise<CaseRun[]> {
  const runsPerCase = options.runsPerCase ?? 1;
  const abortAfter = options.abortAfterConsecutiveFailures ?? 0;
  const selected =
    options.only === undefined
      ? cases
      : cases.filter((benchCase) => benchCase.id === options.only);

  const results: CaseRun[] = [];
  const total = selected.length * runsPerCase;
  let consecutiveFailures = 0;

  for (let pass = 0; pass < runsPerCase; pass += 1) {
    for (const benchCase of selected) {
      const result = await runCase(benchCase, deps);
      results.push(result);
      options.onCase?.(result, results.length, total);

      consecutiveFailures = result.reviewed ? 0 : consecutiveFailures + 1;
      if (abortAfter > 0 && consecutiveFailures >= abortAfter) {
        return results;
      }
    }
  }

  return results;
}

/** The real seat, for the CLI. Kept here so tests never reach the network. */
export const liveSeat: SeatCaller = (request) => callSeat(request);
