import { expect, test } from 'vitest';

import type { Confidence, Finding, Severity } from '../../src/findings/model.js';
import { buildAuditLog } from './audit.js';
import type { BenchCase, ExpectedFinding } from './case.js';
import type { CaseRun } from './score.js';

const PATCH = ['@@ -8,2 +8,4 @@', ' function f() {', '+  a();', '+  b();', ' }'].join('\n');

function benchCase(id: string, kind: BenchCase['kind'], expected: ExpectedFinding[]): BenchCase {
  return {
    id,
    kind,
    category: kind === 'clean' ? 'none' : 'sql-injection',
    description: `what ${id} seeds`,
    files: [{ path: 'src/a.ts', patch: PATCH }],
    expected,
  };
}

function label(line: number, severity: Severity = 'P1'): ExpectedFinding {
  return { path: 'src/a.ts', line, severity, category: 'sql-injection' };
}

function finding(line: number, confidence: Confidence = 'high'): Finding {
  return {
    seat: 'primary',
    model: 'test-model',
    path: 'src/a.ts',
    line,
    severity: 'P1',
    confidence,
    category: 'sql-injection',
    title: `title at ${String(line)}`,
    detail: `detail at ${String(line)}`,
  };
}

function run(overrides: Partial<CaseRun> & { benchCase: BenchCase }): CaseRun {
  return {
    findings: [],
    reviewed: true,
    usage: { inputTokens: 900, outputTokens: 120 },
    costUsd: 0.004,
    latencyMs: 3000,
    ...overrides,
  };
}

test('records what the seat actually said, so a judgement can be audited', () => {
  // Without the finding text, nobody can tell a model that was wrong from a
  // corpus case that was mislabeled, and the corpus cannot be maintained.
  const log = buildAuditLog([
    run({ benchCase: benchCase('sql-001', 'defect', [label(9)]), findings: [finding(9)] }),
  ]);

  expect(log.cases[0]?.findings[0]?.title).toBe('title at 9');
  expect(log.cases[0]?.findings[0]?.detail).toBe('detail at 9');
  expect(log.cases[0]?.expected).toEqual([label(9)]);
});

test('scores each case so an auditor can jump to the disagreements', () => {
  const log = buildAuditLog([
    run({ benchCase: benchCase('a', 'defect', [label(9)]), findings: [finding(9)] }),
    run({ benchCase: benchCase('b', 'defect', [label(9)]), findings: [] }),
    run({ benchCase: benchCase('c', 'clean', []), findings: [finding(9)] }),
  ]);

  expect(log.cases[0]?.verdict).toEqual({ hits: 1, misses: 0, inventions: 0 });
  expect(log.cases[1]?.verdict).toEqual({ hits: 0, misses: 1, inventions: 0 });
  expect(log.cases[2]?.verdict).toEqual({ hits: 0, misses: 0, inventions: 1 });
});

test('lists the cases that disagreed, in one place', () => {
  const log = buildAuditLog([
    run({ benchCase: benchCase('agrees', 'defect', [label(9)]), findings: [finding(9)] }),
    run({ benchCase: benchCase('invents', 'clean', []), findings: [finding(9)] }),
    run({ benchCase: benchCase('misses', 'defect', [label(9)]), findings: [] }),
  ]);

  expect(log.disagreements).toEqual(['invents', 'misses']);
});

test('flags a finding on a clean case for review, since the case may be the wrong one', () => {
  // A clean case that draws a finding is either a false positive or a case
  // labeled clean that is not. Only reading the finding tells you which, and
  // this is the pointer that gets someone to read it.
  const log = buildAuditLog([
    run({ benchCase: benchCase('clean-002', 'clean', []), findings: [finding(9)] }),
  ]);

  expect(log.cases[0]?.needsCorpusReview).toBe(true);
});

test('does not flag a defect case the seat got right', () => {
  const log = buildAuditLog([
    run({ benchCase: benchCase('sql-001', 'defect', [label(9)]), findings: [finding(9)] }),
  ]);

  expect(log.cases[0]?.needsCorpusReview).toBe(false);
});

test('keeps the reason a case did not reach a seat', () => {
  const log = buildAuditLog([
    run({
      benchCase: benchCase('a', 'defect', [label(9)]),
      reviewed: false,
      notReviewedReason: 'seat API returned 429',
    }),
  ]);

  expect(log.cases[0]?.notReviewedReason).toBe('seat API returned 429');
  expect(log.cases[0]?.verdict).toBeNull();
});

test('carries cost and latency per case, so an outlier is findable', () => {
  const log = buildAuditLog([
    run({ benchCase: benchCase('a', 'clean', []), costUsd: 0.02, latencyMs: 9000 }),
  ]);

  expect(log.cases[0]?.costUsd).toBe(0.02);
  expect(log.cases[0]?.latencyMs).toBe(9000);
});

test('orders cases by id, so two runs produce comparable files', () => {
  const log = buildAuditLog([
    run({ benchCase: benchCase('zzz', 'clean', []) }),
    run({ benchCase: benchCase('aaa', 'clean', []) }),
  ]);

  expect(log.cases.map((entry) => entry.id)).toEqual(['aaa', 'zzz']);
});
