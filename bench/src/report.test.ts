import { expect, test } from 'vitest';

import type { Scorecard } from './score.js';
import {
  renderReport,
  renderScorecardBlock,
  SCORECARD_END,
  SCORECARD_START,
  type ReportMeta,
} from './report.js';

const meta: ReportMeta = {
  model: 'test-model',
  promptVersion: '3',
  promptFingerprint: 'abc123def456789a',
  generatedAt: '2026-09-03T12:00:00.000Z',
  lineTolerance: 2,
  runsPerCase: 1,
  prices: { inputPerMTok: 3, outputPerMTok: 15 },
};

const card: Scorecard = {
  cases: {
    total: 48,
    defect: 30,
    clean: 10,
    injection: 8,
    notReviewed: 0,
    scored: 48,
    notReviewedReasons: [],
  },
  overall: {
    truePositives: 20,
    falsePositives: 5,
    falseNegatives: 10,
    precision: 0.8,
    recall: 2 / 3,
    f1: 0.7272727,
  },
  bySeverity: {
    P1: { truePositives: 15, falsePositives: 3, falseNegatives: 5, precision: 0.8333, recall: 0.75, f1: 0.7894 },
  },
  byCategory: {
    'sql-injection': { truePositives: 4, falsePositives: 0, falseNegatives: 1, precision: 1, recall: 0.8, f1: 0.8888 },
  },
  falseBlock: {
    high: { eligible: 18, blocked: 1, rate: 1 / 18 },
    medium: { eligible: 18, blocked: 2, rate: 2 / 18 },
    low: { eligible: 18, blocked: 3, rate: 3 / 18 },
  },
  injectionResistance: { resistant: 7, total: 8, rate: 0.875 },
  severityAgreement: { agreed: 18, matched: 20, rate: 0.9 },
  cost: { medianUsd: 0.0021, totalUsd: 0.1 },
  latency: { medianMs: 4200 },
};

test('names the model and prompt version, so a score is attributable', () => {
  const out = renderReport(card, meta);

  expect(out).toContain('test-model');
  expect(out).toMatch(/prompt version 3/i);
  expect(out).toContain('abc123def456789a');
});

test('publishes the matching rule, since every number depends on it', () => {
  expect(renderReport(card, meta)).toMatch(/within 2 lines/);
});

test('warns that a single run per case carries sampling noise', () => {
  // No sampling controls are available, so one run per case is one sample of a
  // distribution. A report that hid that would overstate its own precision.
  expect(renderReport(card, meta)).toMatch(/one run per case/i);
});

test('drops the warning when the corpus was run repeatedly', () => {
  expect(renderReport(card, { ...meta, runsPerCase: 5 })).not.toMatch(/one run per case/i);
});

test('prints an undefined rate as not measured, never as zero', () => {
  // The difference between "wrong every time" and "never tried" is the whole
  // point of the null.
  const empty: Scorecard = {
    ...card,
    overall: {
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 30,
      precision: null,
      recall: 0,
      f1: null,
    },
  };
  const out = renderReport(empty, meta);

  expect(out).toMatch(/not measured/i);
  expect(out).not.toMatch(/\|\s*0\.0%\s*\|\s*0\.0%/);
});

test('reports how many cases never reached a seat', () => {
  const out = renderReport({ ...card, cases: { ...card.cases, notReviewed: 3, scored: 45 } }, meta);

  expect(out).toMatch(/3/);
  expect(out).toMatch(/did not reach a seat|not reviewed/i);
});

test('gives the false-block rate at every threshold rather than picking one', () => {
  const out = renderReport(card, meta);

  expect(out).toMatch(/high/);
  expect(out).toMatch(/medium/);
  expect(out).toMatch(/low/);
});

test('states the rates behind the cost figure', () => {
  expect(renderReport(card, meta)).toMatch(/3\.00.*15\.00|15\.00.*3\.00/s);
});

test('says no cost was measured when no prices were supplied', () => {
  const out = renderReport(
    { ...card, cost: { medianUsd: null, totalUsd: null } },
    { ...meta, prices: null },
  );

  expect(out).toMatch(/no token prices/i);
});

test('renders the same bytes for the same input', () => {
  // The report is committed, so a rerun that changes nothing must produce no
  // diff. A timestamp read inside the renderer would break that.
  expect(renderReport(card, meta)).toBe(renderReport(card, meta));
});

test('wraps the README block in markers a script can find', () => {
  const block = renderScorecardBlock(card, meta);

  expect(block.startsWith(SCORECARD_START)).toBe(true);
  expect(block.trimEnd().endsWith(SCORECARD_END)).toBe(true);
});

test('keeps the README block short enough to read at a glance', () => {
  expect(renderScorecardBlock(card, meta).split('\n').length).toBeLessThan(30);
});

test('points the README block at the full report', () => {
  expect(renderScorecardBlock(card, meta)).toContain('bench/results/REPORT.md');
});

test('prints why cases did not reach a seat, not just how many', () => {
  // A run that scored nothing is the case where the report matters most, and a
  // bare count is useless to whoever has to fix it.
  const out = renderReport(
    {
      ...card,
      cases: {
        ...card.cases,
        scored: 0,
        notReviewed: 48,
        notReviewedReasons: [
          { reason: 'seat API returned 401: authentication_error', count: 48 },
        ],
      },
      overall: {
        truePositives: 0,
        falsePositives: 0,
        falseNegatives: 0,
        precision: null,
        recall: null,
        f1: null,
      },
    },
    meta,
  );

  expect(out).toContain('401');
  expect(out).toContain('authentication_error');
  expect(out).toMatch(/48/);
});

test('leads with the fact that nothing was scored, so no one reads a blank card as a pass', () => {
  const out = renderReport(
    {
      ...card,
      cases: { ...card.cases, scored: 0, notReviewed: 48, notReviewedReasons: [{ reason: 'boom', count: 48 }] },
    },
    meta,
  );

  expect(out).toMatch(/no case reached a seat|nothing was scored/i);
});

test('omits the failure section when every case reached a seat', () => {
  expect(renderReport(card, meta)).not.toMatch(/did not reach a seat, by reason/i);
});
