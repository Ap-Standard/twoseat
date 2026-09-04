import { expect, test } from 'vitest';

import type { Config } from './config.js';
import type { Confidence, Finding, Severity } from './findings/model.js';
import { UNREVIEWED_LABEL, decidePolicy, wantsUnreviewedLabel, type Decision } from './policy.js';
import type { ReviewOutcome } from './render/review.js';

const baseConfig: Config = {
  primaryModel: 'test-model',
  secondSeatModel: null,
  apiKey: 'test-key-not-a-real-credential',
  tokenCeiling: 120_000,
  costCeilingUsd: 0.5,
  tokenPrices: { inputPerMTok: 3, outputPerMTok: 15 },
  blockingDisabled: false,
  blockingDisabledReason: null,
  blockingConfidence: 'medium',
};

function configWith(overrides: Partial<Config>): Config {
  return { ...baseConfig, ...overrides };
}

function finding(severity: Severity, confidence: Confidence): Finding {
  return {
    seat: 'primary',
    model: 'test-model',
    path: 'src/app.ts',
    line: 2,
    severity,
    confidence,
    category: 'missing-await',
    title: 'unawaited write',
    detail: 'A failure is dropped.',
  };
}

function reviewed(findings: readonly Finding[]): ReviewOutcome {
  return {
    kind: 'reviewed',
    findings,
    rejected: [],
    usage: { inputTokens: 1_000, outputTokens: 200 },
    cost: null,
  };
}

const notReviewed: ReviewOutcome = {
  kind: 'not-reviewed',
  reason: 'The seat did not answer.',
};

test('a run that did not review decides not-reviewed', () => {
  expect(decidePolicy(notReviewed, baseConfig)).toEqual({
    decision: 'not-reviewed',
    blockingFindings: 0,
  });
});

test('a review with no findings passes', () => {
  expect(decidePolicy(reviewed([]), baseConfig)).toEqual({
    decision: 'pass',
    blockingFindings: 0,
  });
});

test('a P1 at the threshold blocks', () => {
  expect(decidePolicy(reviewed([finding('P1', 'high')]), baseConfig)).toEqual({
    decision: 'block',
    blockingFindings: 1,
  });
});

test('a P1 exactly at the threshold blocks, since the threshold is inclusive', () => {
  expect(decidePolicy(reviewed([finding('P1', 'medium')]), baseConfig)).toEqual({
    decision: 'block',
    blockingFindings: 1,
  });
});

test('a P1 below the threshold does not block', () => {
  expect(decidePolicy(reviewed([finding('P1', 'low')]), baseConfig)).toEqual({
    decision: 'pass',
    blockingFindings: 0,
  });
});

test('a stricter threshold declines to block a finding a looser one would', () => {
  const strict = configWith({ blockingConfidence: 'high' });

  expect(decidePolicy(reviewed([finding('P1', 'medium')]), strict)).toEqual({
    decision: 'pass',
    blockingFindings: 0,
  });
});

test('the loosest threshold blocks on any confidence', () => {
  const loose = configWith({ blockingConfidence: 'low' });

  expect(decidePolicy(reviewed([finding('P1', 'low')]), loose)).toEqual({
    decision: 'block',
    blockingFindings: 1,
  });
});

test('a P2 never blocks, however confident the seat is', () => {
  const loose = configWith({ blockingConfidence: 'low' });

  expect(decidePolicy(reviewed([finding('P2', 'high')]), loose)).toEqual({
    decision: 'pass',
    blockingFindings: 0,
  });
});

test('the kill switch turns a block into blocking-disabled', () => {
  const off = configWith({ blockingDisabled: true, blockingDisabledReason: 'the kill switch is set' });

  expect(decidePolicy(reviewed([finding('P1', 'high')]), off)).toEqual({
    decision: 'blocking-disabled',
    blockingFindings: 1,
  });
});

test('a disabled gate still counts what it would have blocked on', () => {
  const off = configWith({ blockingDisabled: true, blockingDisabledReason: 'the kill switch is set' });
  const findings = [finding('P1', 'high'), finding('P1', 'medium')];

  expect(decidePolicy(reviewed(findings), off).blockingFindings).toBe(2);
});

test('blocking-disabled does not collapse into pass when there was nothing to block', () => {
  const off = configWith({ blockingDisabled: true, blockingDisabledReason: 'the kill switch is set' });

  expect(decidePolicy(reviewed([]), off)).toEqual({
    decision: 'blocking-disabled',
    blockingFindings: 0,
  });
});

test('a run that did not review reports that, even with the kill switch on', () => {
  const off = configWith({ blockingDisabled: true, blockingDisabledReason: 'the kill switch is set' });

  expect(decidePolicy(notReviewed, off).decision).toBe('not-reviewed');
});

test('no combination of inputs blocks on a run that did not review', () => {
  const confidences: Confidence[] = ['high', 'medium', 'low'];

  for (const blockingConfidence of confidences) {
    for (const blockingDisabled of [true, false]) {
      const config = configWith({
        blockingConfidence,
        blockingDisabled,
        blockingDisabledReason: blockingDisabled ? 'the kill switch is set' : null,
      });

      const { decision, blockingFindings } = decidePolicy(notReviewed, config);

      expect(decision).toBe('not-reviewed');
      expect(blockingFindings).toBe(0);
    }
  }
});

test('counts every qualifying finding, not just the first', () => {
  const findings = [
    finding('P1', 'high'),
    finding('P1', 'medium'),
    finding('P1', 'low'),
    finding('P2', 'high'),
  ];

  expect(decidePolicy(reviewed(findings), baseConfig)).toEqual({
    decision: 'block',
    blockingFindings: 2,
  });
});

test('only a run that did not review carries the unreviewed label', () => {
  expect(wantsUnreviewedLabel('not-reviewed')).toBe(true);
});

test('every decision that did review clears the unreviewed label', () => {
  const reviewedDecisions: Decision[] = ['pass', 'block', 'blocking-disabled'];

  for (const decision of reviewedDecisions) {
    // A label left behind by an earlier failed run would say the current head
    // was never reviewed, which is a lie about the branch as it stands.
    expect(wantsUnreviewedLabel(decision)).toBe(false);
  }
});

test('the label name is stable, since a rename orphans every label in the wild', () => {
  expect(UNREVIEWED_LABEL).toBe('twoseat:unreviewed');
});
