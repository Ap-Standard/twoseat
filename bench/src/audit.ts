/**
 * The per-case audit trail.
 *
 * Aggregate scores say how the gate did. They cannot say whether a particular
 * judgement was right, and that distinction is the difference between a
 * benchmark somebody can maintain and a number nobody can check.
 *
 * The case that forced this file: a clean case drew a finding on the first real
 * run. That is either a false positive or a case labeled clean that is not
 * clean, and only the text of the finding tells you which. Scores alone had
 * thrown that text away.
 *
 * So every run writes what the seat actually said, next to what the corpus
 * expected, with the per-case verdict. A skeptic can then check any figure in
 * the report against the evidence behind it, which is the whole premise of
 * publishing a scorecard at all.
 */
import type { Finding } from '../../src/findings/model.js';
import type { ExpectedFinding } from './case.js';
import { matchFindings } from './match.js';
import type { CaseRun } from './score.js';

export interface Verdict {
  hits: number;
  misses: number;
  inventions: number;
}

export interface AuditedCase {
  id: string;
  kind: string;
  category: string;
  description: string;
  reviewed: boolean;
  notReviewedReason: string | null;
  expected: ExpectedFinding[];
  findings: Finding[];
  /** Null when the case never reached a seat, so there is nothing to score. */
  verdict: Verdict | null;
  /**
   * True when the disagreement might be the corpus rather than the seat.
   *
   * A finding on a clean case, or a finding nothing seeded, is the signal to go
   * and read the text before believing the score.
   */
  needsCorpusReview: boolean;
  costUsd: number | null;
  latencyMs: number;
}

export interface AuditLog {
  cases: AuditedCase[];
  /** Ids where the seat and the corpus disagreed. An auditor's first stop. */
  disagreements: string[];
}

/** Codepoint ordering, so two runs produce comparable files. */
function byText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function buildAuditLog(runs: readonly CaseRun[]): AuditLog {
  const cases: AuditedCase[] = [];

  for (const entry of runs) {
    const result = entry.reviewed ? matchFindings(entry.findings, entry.benchCase.expected) : null;

    const verdict: Verdict | null =
      result === null
        ? null
        : {
            hits: result.matched.length,
            misses: result.falseNegatives.length,
            inventions: result.falsePositives.length,
          };

    cases.push({
      id: entry.benchCase.id,
      kind: entry.benchCase.kind,
      category: entry.benchCase.category,
      description: entry.benchCase.description,
      reviewed: entry.reviewed,
      notReviewedReason: entry.notReviewedReason ?? null,
      expected: [...entry.benchCase.expected],
      findings: [...entry.findings],
      verdict,
      needsCorpusReview: verdict !== null && verdict.inventions > 0,
      costUsd: entry.costUsd,
      latencyMs: entry.latencyMs,
    });
  }

  cases.sort((a, b) => byText(a.id, b.id));

  return {
    cases,
    disagreements: cases
      .filter((entry) => entry.verdict !== null && (entry.verdict.misses > 0 || entry.verdict.inventions > 0))
      .map((entry) => entry.id),
  };
}
