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
 *
 * The pairing maximizes hits. Taking each label's nearest finding in turn is
 * not the same thing: with labels at 10 and 12 and findings at 8 and 10, the
 * nearest-first pass gives label 10 the finding at 10 and leaves label 12 with
 * nothing in range, reporting one hit, one miss, and one invention. An
 * assignment exists in which both findings sit inside tolerance of a label, so
 * both did locate a seeded defect, and calling either an invention would be
 * false. This is not generosity toward the seat. It is the truthful reading of
 * the evidence, and getting it wrong understates the gate.
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

function inRange(finding: Finding, label: ExpectedFinding): boolean {
  return (
    finding.path === label.path && Math.abs(finding.line - label.line) <= LINE_TOLERANCE
  );
}

export function matchFindings(
  reported: readonly Finding[],
  expected: readonly ExpectedFinding[],
): MatchResult {
  // Labels in a fixed order, and every field that distinguishes two labels
  // takes part, so the pairing never depends on how the caller listed them.
  const labels = [...expected].sort(
    (a, b) =>
      byText(a.path, b.path) ||
      a.line - b.line ||
      byText(a.severity, b.severity) ||
      byText(a.category, b.category),
  );

  // Each label's eligible findings, nearest first. The preference order is
  // deterministic, which keeps the assignment below deterministic too.
  const preferences = labels.map((label) =>
    reported
      .map((finding, index) => ({ finding, index }))
      .filter((entry) => inRange(entry.finding, label))
      .sort(
        (a, b) =>
          Math.abs(a.finding.line - label.line) - Math.abs(b.finding.line - label.line) ||
          a.finding.line - b.finding.line ||
          byText(a.finding.title, b.finding.title) ||
          a.index - b.index,
      )
      .map((entry) => entry.index),
  );

  /**
   * Augmenting-path search for a maximum-cardinality assignment.
   *
   * One label absorbs one finding and one finding satisfies one label, so this
   * is bipartite matching. Sizes here are tiny, a handful of labels against at
   * most a few dozen findings, so the simple augmenting-path walk is both fast
   * enough and easy to read.
   */
  const assignedTo = new Map<number, number>(); // finding index -> label index

  function augment(labelIndex: number, visited: Set<number>): boolean {
    for (const findingIndex of preferences[labelIndex] ?? []) {
      if (visited.has(findingIndex)) {
        continue;
      }
      visited.add(findingIndex);

      const holder = assignedTo.get(findingIndex);
      // Free, or its current holder can be re-seated somewhere else.
      if (holder === undefined || augment(holder, visited)) {
        assignedTo.set(findingIndex, labelIndex);
        return true;
      }
    }
    return false;
  }

  for (let labelIndex = 0; labelIndex < labels.length; labelIndex += 1) {
    augment(labelIndex, new Set<number>());
  }

  const pairedFinding = new Map<number, number>(); // label index -> finding index
  for (const [findingIndex, labelIndex] of assignedTo) {
    pairedFinding.set(labelIndex, findingIndex);
  }

  const matched: MatchedPair[] = [];
  const falseNegatives: ExpectedFinding[] = [];

  labels.forEach((label, labelIndex) => {
    const findingIndex = pairedFinding.get(labelIndex);
    const finding = findingIndex === undefined ? undefined : reported[findingIndex];

    if (finding === undefined) {
      falseNegatives.push(label);
      return;
    }
    matched.push({ expected: label, reported: finding });
  });

  return {
    matched,
    falsePositives: reported.filter((_finding, index) => !assignedTo.has(index)),
    falseNegatives,
  };
}
