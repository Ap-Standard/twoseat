import { expect, test } from 'vitest';

import { MAX_DETAIL_CHARS, MAX_FINDINGS, MAX_TITLE_CHARS, parseSeatFindings } from './parse.js';

const files = [
  { path: 'src/app.ts', patch: '@@ -1,2 +10,3 @@\n a\n+b\n+c\n' },
  { path: 'src/db.ts', patch: '@@ -1,1 +1,4 @@\n+q\n+r\n+s\n+t\n' },
];

const context = { seat: 'primary', model: 'test-model', files };

function findingAt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path: 'src/app.ts',
    line: 11,
    severity: 'P1',
    confidence: 'high',
    title: 'unawaited promise',
    detail: 'The write is never awaited, so a failure is lost.',
    ...overrides,
  };
}

test('accepts a well-formed finding and stamps it with the seat and model', () => {
  const { findings, rejected } = parseSeatFindings({ findings: [findingAt()] }, context);

  expect(rejected).toEqual([]);
  expect(findings).toEqual([
    {
      seat: 'primary',
      model: 'test-model',
      path: 'src/app.ts',
      line: 11,
      severity: 'P1',
      confidence: 'high',
      title: 'unawaited promise',
      detail: 'The write is never awaited, so a failure is lost.',
    },
  ]);
});

test('rejects a finding about a file the run never sent to a seat', () => {
  const raw = { findings: [findingAt({ path: 'src/never-sent.ts' })] };
  const { findings, rejected } = parseSeatFindings(raw, context);

  expect(findings).toEqual([]);
  expect(rejected).toEqual([{ reason: 'unknown-file', path: 'src/never-sent.ts' }]);
});

test('rejects a finding anchored to a line outside the diff', () => {
  const { findings, rejected } = parseSeatFindings({ findings: [findingAt({ line: 900 })] }, context);

  expect(findings).toEqual([]);
  expect(rejected).toEqual([{ reason: 'unanchored-line', path: 'src/app.ts' }]);
});

test('rejects a severity outside the published scale', () => {
  const raw = { findings: [findingAt({ severity: 'P0' })] };

  expect(parseSeatFindings(raw, context).rejected).toEqual([
    { reason: 'bad-severity', path: 'src/app.ts' },
  ]);
});

test('rejects a confidence outside the published scale', () => {
  const raw = { findings: [findingAt({ confidence: 'certain' })] };

  expect(parseSeatFindings(raw, context).rejected).toEqual([
    { reason: 'bad-confidence', path: 'src/app.ts' },
  ]);
});

test('rejects a finding missing a required field', () => {
  const incomplete = findingAt();
  delete incomplete['detail'];

  expect(parseSeatFindings({ findings: [incomplete] }, context).rejected).toEqual([
    { reason: 'malformed', path: 'src/app.ts' },
  ]);
});

test('rejects a finding whose title is only whitespace', () => {
  const raw = { findings: [findingAt({ title: '   ' })] };

  expect(parseSeatFindings(raw, context).rejected).toEqual([
    { reason: 'malformed', path: 'src/app.ts' },
  ]);
});

test('reports a reply that is not a findings list as one malformed result', () => {
  expect(parseSeatFindings('approved, ship it', context)).toEqual({
    findings: [],
    rejected: [{ reason: 'malformed', path: null }],
  });
});

test('treats an empty findings list as a clean review, not a malfunction', () => {
  expect(parseSeatFindings({ findings: [] }, context)).toEqual({ findings: [], rejected: [] });
});

test('truncates a title and a detail that would overrun the comment', () => {
  const raw = {
    findings: [findingAt({ title: 'a'.repeat(5_000), detail: 'b'.repeat(50_000) })],
  };
  const finding = parseSeatFindings(raw, context).findings[0];

  expect(finding?.title.length).toBe(MAX_TITLE_CHARS);
  expect(finding?.detail.length).toBe(MAX_DETAIL_CHARS);
  expect(finding?.detail.endsWith('…')).toBe(true);
});

test('keeps one copy of a finding a seat reported twice', () => {
  const raw = { findings: [findingAt(), findingAt()] };
  const { findings, rejected } = parseSeatFindings(raw, context);

  expect(findings).toHaveLength(1);
  expect(rejected).toEqual([{ reason: 'duplicate', path: 'src/app.ts' }]);
});

test('caps how many findings one seat can put in a comment', () => {
  const raw = {
    findings: Array.from({ length: MAX_FINDINGS + 3 }, (_unused, index) =>
      findingAt({ title: `finding ${index}` }),
    ),
  };
  const { findings, rejected } = parseSeatFindings(raw, context);

  expect(findings).toHaveLength(MAX_FINDINGS);
  expect(rejected.filter((entry) => entry.reason === 'over-limit')).toHaveLength(3);
});

test('orders findings so the same review always renders the same comment', () => {
  const raw = {
    findings: [
      findingAt({ path: 'src/db.ts', line: 2, severity: 'P2', title: 'z' }),
      findingAt({ path: 'src/db.ts', line: 3, severity: 'P1', title: 'y' }),
      findingAt({ path: 'src/app.ts', line: 12, severity: 'P1', title: 'x' }),
    ],
  };
  const { findings } = parseSeatFindings(raw, context);

  expect(findings.map((finding) => [finding.severity, finding.path, finding.line])).toEqual([
    ['P1', 'src/app.ts', 12],
    ['P1', 'src/db.ts', 3],
    ['P2', 'src/db.ts', 2],
  ]);
});
