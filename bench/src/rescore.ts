/**
 * Re-scoring a run that already happened.
 *
 * When the scoring rules change, the question is what the recorded run means
 * under the new rules. Paying for a fresh run answers a different question:
 * every figure moves, because every case is a new sample, and the one change
 * under review disappears into the noise. Re-scoring the committed audit trail
 * isolates it, so the diff shows exactly which numbers the rule change moved
 * and proves the rest did not.
 *
 * **The hazard is real and this module exists to close it.** The audit trail
 * records what a seat said; the corpus holds the labels it was judged against.
 * Applying edited labels to old output is fitting the ruler to the thing it
 * measured, dressed up as a free correction. So the labels must be unchanged,
 * and this refuses to rebuild anything when they are not.
 */
import type { AuditLog } from './audit.js';
import type { BenchCase } from './case.js';
import type { CaseRun } from './score.js';

export interface RescoreResult {
  /** Absent when the corpus drifted. There is no partial answer worth having. */
  runs?: CaseRun[];
  problems: string[];
}

/** The answer key a seat was scored against, as a comparable string. */
function answerKey(kind: string, expected: readonly unknown[]): string {
  const labels = expected
    .map((label) => JSON.stringify(label))
    .slice()
    .sort();
  return JSON.stringify({ kind, labels });
}

/**
 * Rebuilds scorable runs from a recorded run plus the current corpus.
 *
 * The corpus supplies what the audit trail does not record: the patches, the
 * declared injection, and what that injection induces. Everything the seat was
 * judged on comes from the recording.
 *
 * A case may gain a declaration it did not have, which is how #16 landed. It
 * may not change `kind` or a single label.
 */
export function rebuildRuns(log: AuditLog, corpus: readonly BenchCase[]): RescoreResult {
  const byId = new Map(corpus.map((benchCase) => [benchCase.id, benchCase]));
  const problems: string[] = [];
  const runs: CaseRun[] = [];

  for (const recorded of log.cases) {
    const benchCase = byId.get(recorded.id);
    if (benchCase === undefined) {
      problems.push(
        `${recorded.id}: scored in the recorded run but no longer in the corpus, so there is ` +
          'nothing to re-score it against',
      );
      continue;
    }
    byId.delete(recorded.id);

    const before = answerKey(recorded.kind, recorded.expected);
    const after = answerKey(benchCase.kind, benchCase.expected);
    if (before !== after) {
      problems.push(
        `${recorded.id}: its kind or expected labels changed since the run. Re-scoring old ` +
          'seat output against edited labels would fit the corpus to the answers it received. ' +
          'Run the benchmark again instead.',
      );
      continue;
    }

    runs.push({
      benchCase,
      findings: recorded.findings,
      reviewed: recorded.reviewed,
      ...(recorded.notReviewedReason === null
        ? {}
        : { notReviewedReason: recorded.notReviewedReason }),
      // Not recorded per case, and scoring reads cost and latency rather than
      // token counts, so nothing downstream depends on this.
      usage: { inputTokens: 0, outputTokens: 0 },
      costUsd: recorded.costUsd,
      latencyMs: recorded.latencyMs,
    });
  }

  for (const id of byId.keys()) {
    problems.push(
      `${id}: in the corpus but not in the recorded run, so re-scoring would report a corpus ` +
        'size the run never covered',
    );
  }

  if (problems.length > 0) {
    return { problems };
  }

  return { runs, problems: [] };
}
