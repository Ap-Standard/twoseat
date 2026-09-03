import { expect, test } from 'vitest';

import type { Finding } from '../../src/findings/model.js';
import type { ExpectedFinding } from './case.js';
import { LINE_TOLERANCE, matchFindings } from './match.js';

function reported(line: number, extra: Partial<Finding> = {}): Finding {
  return {
    seat: 'primary',
    model: 'test-model',
    path: 'src/users.ts',
    line,
    severity: 'P1',
    confidence: 'high',
    category: 'sql-injection',
    title: `finding at ${String(line)}`,
    detail: 'detail',
    ...extra,
  };
}

function label(line: number, extra: Partial<ExpectedFinding> = {}): ExpectedFinding {
  return { path: 'src/users.ts', line, severity: 'P1', category: 'sql-injection', ...extra };
}

test('matches a finding on the labeled line', () => {
  const result = matchFindings([reported(10)], [label(10)]);

  expect(result.matched).toHaveLength(1);
  expect(result.falsePositives).toEqual([]);
  expect(result.falseNegatives).toEqual([]);
});

test('matches a finding within the published line tolerance', () => {
  // A seat can anchor a defect a line or two from where it was seeded, on the
  // call rather than the assignment. Demanding an exact line would score a
  // correct finding as two errors at once, a miss and an invention.
  const result = matchFindings([reported(10 + LINE_TOLERANCE)], [label(10)]);

  expect(result.matched).toHaveLength(1);
});

test('does not match a finding beyond the tolerance', () => {
  const result = matchFindings([reported(10 + LINE_TOLERANCE + 1)], [label(10)]);

  expect(result.matched).toEqual([]);
  expect(result.falsePositives).toHaveLength(1);
  expect(result.falseNegatives).toHaveLength(1);
});

test('does not match across files, however close the line', () => {
  const result = matchFindings([reported(10, { path: 'src/other.ts' })], [label(10)]);

  expect(result.matched).toEqual([]);
  expect(result.falsePositives).toHaveLength(1);
  expect(result.falseNegatives).toHaveLength(1);
});

test('matches on location even when the severity disagrees', () => {
  // Finding the defect and misjudging how bad it is are different failures.
  // Location decides the match; severity agreement is measured separately.
  const result = matchFindings([reported(10, { severity: 'P2' })], [label(10)]);

  expect(result.matched).toHaveLength(1);
  expect(result.matched[0]?.reported.severity).toBe('P2');
  expect(result.matched[0]?.expected.severity).toBe('P1');
});

test('lets one label absorb only one finding', () => {
  // Two findings on the same line are one hit and one invention, not two hits.
  // Scoring them both as correct would let a seat inflate recall by repeating
  // itself.
  const result = matchFindings([reported(10), reported(11)], [label(10)]);

  expect(result.matched).toHaveLength(1);
  expect(result.falsePositives).toHaveLength(1);
});

test('counts a label nothing reached as a miss', () => {
  const result = matchFindings([reported(10)], [label(10), label(40)]);

  expect(result.matched).toHaveLength(1);
  expect(result.falseNegatives).toEqual([label(40)]);
});

test('gives a label the closest finding when several are in range', () => {
  const result = matchFindings([reported(12), reported(10)], [label(10)]);

  expect(result.matched[0]?.reported.line).toBe(10);
});

test('produces the same result whatever order the findings arrive in', () => {
  const labels = [label(10), label(30)];
  const forward = matchFindings([reported(11), reported(31)], labels);
  const reverse = matchFindings([reported(31), reported(11)], labels);

  expect(forward.matched.map((pair) => [pair.expected.line, pair.reported.line])).toEqual(
    reverse.matched.map((pair) => [pair.expected.line, pair.reported.line]),
  );
});

test('reports every finding on a clean case as a false positive', () => {
  const result = matchFindings([reported(10), reported(20)], []);

  expect(result.falsePositives).toHaveLength(2);
  expect(result.matched).toEqual([]);
});

test('reports nothing at all for a clean case a seat left alone', () => {
  expect(matchFindings([], [])).toEqual({
    matched: [],
    falsePositives: [],
    falseNegatives: [],
  });
});
