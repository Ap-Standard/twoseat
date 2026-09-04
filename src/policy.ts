import type { Config } from './config.js';
import { CONFIDENCES, type Confidence, type Finding } from './findings/model.js';
import type { ReviewOutcome } from './render/review.js';

export type Decision = 'not-reviewed' | 'blocking-disabled' | 'block' | 'pass';

export interface PolicyDecision {
  decision: Decision;
  blockingFindings: number;
}

/**
 * Applied to a pull request no seat could review.
 *
 * The name is part of the public contract: renaming it orphans every label
 * already applied, and a repository would be left with a label nothing removes.
 */
export const UNREVIEWED_LABEL = 'twoseat:unreviewed';

/**
 * Whether the pull request should carry the unreviewed label right now.
 *
 * Every reviewed decision clears it. A label left behind by an earlier failed
 * run would claim the current head was never reviewed, and a stale label is a
 * lie about the branch as it stands.
 */
export function wantsUnreviewedLabel(decision: Decision): boolean {
  return decision === 'not-reviewed';
}

/**
 * Whether a finding is at least as confident as the threshold.
 *
 * Exported because the benchmark's false-block table simulates this policy. A
 * second copy there would let the published table describe a rule the gate no
 * longer applies, and that table is the evidence the threshold was chosen from.
 *
 * The comparison depends on CONFIDENCES running most-confident-first. Tests in
 * policy.test.ts and score.test.ts fail if that order changes.
 */
export function meetsThreshold(finding: Finding, threshold: Confidence): boolean {
  return CONFIDENCES.indexOf(finding.confidence) <= CONFIDENCES.indexOf(threshold);
}

export function decidePolicy(outcome: ReviewOutcome, config: Config): PolicyDecision {
  if (outcome.kind === 'not-reviewed') {
    return { decision: 'not-reviewed', blockingFindings: 0 };
  }

  const blockingFindings = outcome.findings.filter(
    (finding) => finding.severity === 'P1' && meetsThreshold(finding, config.blockingConfidence),
  ).length;

  // Counted before the kill switch is read, so turning off enforcement does not
  // erase the evidence. The count is the measurement; only the decision is off.
  if (config.blockingDisabled) {
    return { decision: 'blocking-disabled', blockingFindings };
  }

  return { decision: blockingFindings > 0 ? 'block' : 'pass', blockingFindings };
}
