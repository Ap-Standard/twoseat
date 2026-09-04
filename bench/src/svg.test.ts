import { expect, test } from 'vitest';

import type { ReportMeta } from './report.js';
import type { Scorecard } from './score.js';
import { renderScorecardSvg } from './svg.js';

const meta: ReportMeta = {
  model: 'test-model',
  promptVersion: '3',
  promptFingerprint: 'abc123def456789a',
  generatedAt: '2026-09-03T09:41:25.387Z',
  lineTolerance: 2,
  runsPerCase: 1,
  prices: { inputPerMTok: 3, outputPerMTok: 15 },
};

// Hand-derived: 38 hits and 1 invention give precision 38/39 = 0.9743 (97.4%),
// recall 1 (100.0%), F1 2pr/(p+r) = 0.9870 (98.7%). Cost 0.009228 prints $0.0092.
const card: Scorecard = {
  cases: {
    total: 48,
    defect: 30,
    clean: 10,
    injection: 8,
    notReviewed: 1,
    scored: 47,
    notReviewedReasons: [{ reason: 'unreadable reply', count: 1 }],
  },
  overall: {
    truePositives: 38,
    falsePositives: 1,
    falseNegatives: 0,
    precision: 38 / 39,
    recall: 1,
    f1: (2 * (38 / 39) * 1) / (38 / 39 + 1),
  },
  bySeverity: {},
  byCategory: {},
  falseBlock: {},
  injection: {
    total: 8,
    suppressed: 0,
    inducible: 1,
    induced: 0,
    decidableSites: 3,
    undecidableSites: 5,
    reportedInjection: 1,
    resistant: 8,
    rate: 1,
    suppressionRate: 0,
  },
  severityAgreement: { agreed: 35, matched: 38, rate: 35 / 38 },
  cost: { medianUsd: 0.009228, totalUsd: 0.411636 },
  latency: { medianMs: 3892 },
};

test('renders the four headline numbers, the scored count, and the as-of date', () => {
  const svg = renderScorecardSvg(card, meta);

  expect(svg).toContain('97.4%');
  expect(svg).toContain('100.0%');
  expect(svg).toContain('98.7%');
  expect(svg).toContain('$0.0092');
  expect(svg).toContain('47 of 48');
  expect(svg).toContain('Single run per case');
  expect(svg).toMatch(/upper bound/);
  expect(svg).toContain('As of 2026-09-03');
  // Committed and drift-checked, so the same input must give the same bytes.
  expect(svg).toBe(renderScorecardSvg(card, meta));
});

test('escapes text that reaches the markup and references nothing outside the file', () => {
  const hostile: ReportMeta = { ...meta, model: '<script>alert("x")</script> & "co"' };
  const svg = renderScorecardSvg(card, hostile);

  expect(svg).not.toContain('<script>');
  expect(svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;co&quot;');
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  // GitHub proxies README images and strips external fetches, so a hero that
  // needs one would render differently from the file on disk.
  expect(svg).not.toMatch(/xlink:href|href=|@import|url\(|<image|<style|<foreignObject/);
});

test('renders the not-scored state in words, never as zero', () => {
  const empty: Scorecard = {
    ...card,
    cases: {
      ...card.cases,
      scored: 0,
      notReviewed: 48,
      notReviewedReasons: [{ reason: 'seat API returned 401', count: 48 }],
    },
    overall: {
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      precision: null,
      recall: null,
      f1: null,
    },
    cost: { medianUsd: null, totalUsd: null },
  };
  const svg = renderScorecardSvg(empty, meta);

  expect(svg).toMatch(/nothing was scored/i);
  expect(svg).toContain('0 of 48');
  expect((svg.match(/not measured/g) ?? []).length).toBeGreaterThanOrEqual(4);
  expect(svg).not.toMatch(/0\.0%/);
  expect(svg).not.toContain('$0.0000');
});
