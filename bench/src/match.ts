/**
 * Deciding whether a reported finding is the seeded one.
 *
 * Every number in the report rests on this file, so the rule is published
 * rather than buried: a finding matches a label when it names the same file and
 * lands within LINE_TOLERANCE lines of the seeded defect. Widening the
 * tolerance inflates recall, and narrowing it inflates both misses and
 * inventions from the same correct finding. The value is a judgment call, and
 * naming it is what makes the scores comparable to each other.
 *
 * Location alone decides a match. Severity agreement is measured separately,
 * because finding a defect and misjudging how bad it is are different failures
 * and a single number that merged them would hide both.
 */
import type { Finding } from '../../src/findings/model.js';
import type { ExpectedFinding } from './case.js';

/**
 * How far from the seeded line a finding may anchor and still count.
 *
 * A seat often anchors a defect on the call rather than the assignment, or on
 * the closing line of a statement it spans. Two lines covers that without
 * letting a finding on unrelated code claim the label.
 */
export const LINE_TOLERANCE = 2;

export interface MatchedPair {
  expected: ExpectedFinding;
  reported: Finding;
}

export interface MatchResult {
  matched: MatchedPair[];
  /** Reported, and matching no label. An invention. */
  falsePositives: Finding[];
  /** Labeled, and reached by nothing. A miss. */
  falseNegatives: ExpectedFinding[];
}

/** Codepoint ordering, so a result does not vary with the runner's locale. */
function byText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function matchFindings(
  reported: readonly Finding[],
  expected: readonly ExpectedFinding[],
): MatchResult {
  const matched: MatchedPair[] = [];
  const falseNegatives: ExpectedFinding[] = [];
  const claimed = new Set<Finding>();

  // Labels in a fixed order, so the pairing does not depend on how the seat
  // happened to order its reply.
  const labels = [...expected].sort(
    (a, b) => byText(a.path, b.path) || a.line - b.line || byText(a.category, b.category),
  );

  for (const label of labels) {
    const candidates = reported
      .filter(
        (finding) =>
          !claimed.has(finding) &&
          finding.path === label.path &&
          Math.abs(finding.line - label.line) <= LINE_TOLERANCE,
      )
      // Closest line wins. Ties break on line then title, never on arrival.
      .sort(
        (a, b) =>
          Math.abs(a.line - label.line) - Math.abs(b.line - label.line) ||
          a.line - b.line ||
          byText(a.title, b.title),
      );

    const winner = candidates[0];
    if (winner === undefined) {
      falseNegatives.push(label);
      continue;
    }

    // One label absorbs one finding. Two findings on the same line are one hit
    // and one invention, or a seat could inflate recall by repeating itself.
    claimed.add(winner);
    matched.push({ expected: label, reported: winner });
  }

  return {
    matched,
    falsePositives: reported.filter((finding) => !claimed.has(finding)),
    falseNegatives,
  };
}
