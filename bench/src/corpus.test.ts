import { expect, test } from 'vitest';

import { CATEGORIES } from '../../src/findings/model.js';
import { CASES_DIR, readCorpus } from './corpus.js';

const { cases, problems } = readCorpus(CASES_DIR);

test('every case in the corpus validates against itself', () => {
  // The corpus is the measuring instrument. A label pointing outside its own
  // diff would mark a correct seat wrong, so this runs on every pull request
  // and needs no API key.
  expect(problems).toEqual([]);
});

test('the corpus carries at least 30 seeded defect cases', () => {
  expect(cases.filter((entry) => entry.kind === 'defect').length).toBeGreaterThanOrEqual(30);
});

test('the corpus carries at least 8 prompt-injection cases', () => {
  expect(cases.filter((entry) => entry.kind === 'injection').length).toBeGreaterThanOrEqual(8);
});

test('the corpus carries clean cases, without which no false positive is countable', () => {
  expect(cases.filter((entry) => entry.kind === 'clean').length).toBeGreaterThanOrEqual(10);
});

test('every seeded defect class named in the issue appears in the corpus', () => {
  const seeded = new Set(
    cases.flatMap((entry) => entry.expected.map((label) => label.category)),
  );

  for (const category of [
    'sql-injection',
    'missing-await',
    'toctou',
    'secret-in-diff',
    'n-plus-one',
    'unsafe-migration',
    'authz-bypass',
  ]) {
    expect(seeded.has(category), `no case seeds ${category}`).toBe(true);
  }
});

test('every seeded class is one the findings schema can express', () => {
  // A label the schema cannot produce would be an automatic miss, and the
  // scorecard would blame the seat for a gap in the taxonomy.
  for (const entry of cases) {
    for (const label of entry.expected) {
      expect(CATEGORIES).toContain(label.category);
    }
  }
});

test('the corpus seeds both severities, so per-severity figures have data', () => {
  const severities = new Set(
    cases.flatMap((entry) => entry.expected.map((label) => label.severity)),
  );

  expect(severities).toContain('P1');
  expect(severities).toContain('P2');
});

test('clean cases outnumber nothing: each is a chance to record a false positive', () => {
  const clean = cases.filter((entry) => entry.kind === 'clean');

  for (const entry of clean) {
    expect(entry.expected).toEqual([]);
  }
});

test('every injection case carries an instruction that a diff really contains', () => {
  const injections = cases.filter((entry) => entry.kind === 'injection');

  for (const entry of injections) {
    expect(entry.injection).toBeDefined();
    const patches = entry.files.map((file) => file.patch).join('\n');
    expect(patches).toContain(entry.injection ?? '__missing__');
  }
});

test('injection cases test both directions of the attack', () => {
  // Suppressing a real finding is one failure. Inducing an invented one is the
  // other, and a corpus that only tested the first would miss half of it.
  const injections = cases.filter((entry) => entry.kind === 'injection');

  expect(injections.some((entry) => entry.expected.length > 0)).toBe(true);
  expect(injections.some((entry) => entry.expected.length === 0)).toBe(true);
});

test('case ids are unique and stable, since results are keyed by them', () => {
  const ids = cases.map((entry) => entry.id);

  expect(new Set(ids).size).toBe(ids.length);
});

test('reads cases in a fixed order, so a run is reproducible', () => {
  const again = readCorpus(CASES_DIR);

  expect(again.cases.map((entry) => entry.id)).toEqual(cases.map((entry) => entry.id));
});
