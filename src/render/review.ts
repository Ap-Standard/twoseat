/**
 * The single summary comment a run maintains on a pull request.
 *
 * Two rules shape it. A run that did not review says so in its first line: a
 * failed seat rendered as a clean review would tell a reviewer the diff was
 * checked when nothing checked it, which is the most damaging thing this file
 * could do. And nothing is dropped quietly: withheld files and discarded seat
 * output are counted with reasons, because a gate that silently discards half a
 * review looks identical to one that found nothing.
 *
 * Every figure carries the method that produced it. A cost with no rate beside
 * it is not a measurement.
 */
import type { Config } from '../config.js';
import type { CostEstimate, Usage } from '../cost.js';
import type { Finding, Severity } from '../findings/model.js';
import type { RejectReason, RejectedFinding } from '../findings/parse.js';
import { SEVERITIES } from '../findings/model.js';
import type { BudgetPlan, DropReason } from '../ingest/budget.js';
import { redactSecret } from '../redact.js';
import { COMMENT_MARKER } from './comment.js';
import { neutralizeForComment, neutralizePathForComment } from './text.js';

export interface ReviewedOutcome {
  kind: 'reviewed';
  findings: readonly Finding[];
  rejected: readonly RejectedFinding[];
  usage: Usage;
  /** Null when the workflow supplied no token prices. */
  cost: CostEstimate | null;
}

export interface NotReviewedOutcome {
  kind: 'not-reviewed';
  /** Why, in the comment. A silent non-review is indistinguishable from a pass. */
  reason: string;
}

export type ReviewOutcome = ReviewedOutcome | NotReviewedOutcome;

export interface ReviewCommentInput {
  config: Config;
  plan: BudgetPlan;
  promptVersion: string;
  outcome: ReviewOutcome;
}

const DROP_REASONS: Record<DropReason, string> = {
  'no-patch': 'no patch supplied, binary or too large',
  generated: 'generated file',
  'over-budget': 'over the diff budget',
};

const REJECT_REASONS: Record<RejectReason, string> = {
  malformed: 'not shaped like a finding',
  'unknown-file': 'named a file the run did not send',
  'unanchored-line': 'anchored to a line outside the diff',
  'bad-severity': 'used a severity outside the published scale',
  'bad-confidence': 'used a confidence outside the published scale',
  duplicate: 'reported twice by the same seat',
  'over-limit': 'past the cap on findings from one seat',
};

/** Deterministic grouping, so the same review always renders the same comment. */
function formatInt(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function blockingCell(config: Config): string {
  if (!config.blockingDisabled) {
    return 'enabled';
  }
  return `disabled (${config.blockingDisabledReason ?? 'no reason recorded'})`;
}

function countBySeverity(findings: readonly Finding[]): Map<Severity, number> {
  const counts = new Map<Severity, number>();
  for (const severity of SEVERITIES) {
    const total = findings.filter((finding) => finding.severity === severity).length;
    if (total > 0) {
      counts.set(severity, total);
    }
  }
  return counts;
}

/**
 * Prepares text that a seat, or an API talking to one, produced.
 *
 * Redaction comes before neutralizing. core.setSecret masks a value in the run
 * log and does nothing for a comment body, so a diff that commits a credential
 * and a seat that correctly reports it would otherwise publish that credential
 * to a public pull request.
 */
type Scrub = (text: string) => string;

function scrubber(config: Config): Scrub {
  return (text) => neutralizeForComment(redactSecret(text, config.apiKey));
}

function headline(outcome: ReviewOutcome, scrub: Scrub): string {
  if (outcome.kind === 'not-reviewed') {
    return `**The review did not run.** ${scrub(outcome.reason)}`;
  }

  const counts = countBySeverity(outcome.findings);
  if (counts.size === 0) {
    return '**No findings.** The seat reviewed the diff below and reported nothing.';
  }

  const parts = [...counts].map(([severity, total]) => `${formatInt(total)} ${severity}`);
  return `**${parts.join(', ')}.**`;
}

function costRows(input: ReviewCommentInput): string[] {
  if (input.outcome.kind !== 'reviewed') {
    return [];
  }

  const { usage, cost } = input.outcome;
  const rows = [
    `| Tokens | ${formatInt(usage.inputTokens)} in, ${formatInt(usage.outputTokens)} out |`,
  ];

  if (cost === null) {
    rows.push('| Estimated cost | not available |');
  } else {
    rows.push(`| Estimated cost | $${cost.usd.toFixed(4)} |`);
  }

  return rows;
}

function costNote(input: ReviewCommentInput): string[] {
  if (input.outcome.kind !== 'reviewed') {
    return [];
  }

  const { cost } = input.outcome;
  if (cost === null) {
    return [
      '',
      'No cost estimate: this workflow supplied no token prices, so the dollar ' +
        'ceiling is not enforced. The token ceiling still applies.',
    ];
  }

  return ['', `Cost is estimated from the token counts above, ${cost.basis}.`];
}

function findingLines(findings: readonly Finding[], scrub: Scrub): string[] {
  if (findings.length === 0) {
    return [];
  }

  const lines = ['', '#### Findings', ''];
  for (const finding of findings) {
    const anchor = `${neutralizePathForComment(finding.path)}:${String(finding.line)}`;
    lines.push(
      `- **${finding.severity}** \`${anchor}\` **${scrub(finding.title)}**`,
      `  Confidence ${finding.confidence}, reported by the ${finding.seat} seat ` +
        `running \`${neutralizePathForComment(finding.model)}\`.`,
      `  ${scrub(finding.detail)}`,
    );
  }

  return lines;
}

function withheldLines(plan: BudgetPlan): string[] {
  if (plan.dropped.length === 0) {
    return [];
  }

  const lines = ['', `#### Not sent to a seat (${formatInt(plan.dropped.length)})`, ''];
  for (const file of plan.dropped) {
    lines.push(
      `- \`${neutralizePathForComment(file.path)}\` (${DROP_REASONS[file.reason]}, ` +
        `${formatInt(file.chars)} characters)`,
    );
  }

  return lines;
}

function discardedLines(outcome: ReviewOutcome): string[] {
  if (outcome.kind !== 'reviewed' || outcome.rejected.length === 0) {
    return [];
  }

  const counts = new Map<RejectReason, number>();
  for (const entry of outcome.rejected) {
    counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  }

  const lines = ['', `#### Discarded seat output (${formatInt(outcome.rejected.length)})`, ''];
  // Ordered by the reason table, not by arrival, so the section is stable.
  for (const reason of Object.keys(REJECT_REASONS) as RejectReason[]) {
    const total = counts.get(reason);
    if (total !== undefined) {
      lines.push(`- ${formatInt(total)} ${REJECT_REASONS[reason]}`);
    }
  }

  return lines;
}

export function renderReviewBody(input: ReviewCommentInput): string {
  const { config, plan, promptVersion, outcome } = input;
  const scrub = scrubber(config);

  const lines: string[] = [
    COMMENT_MARKER,
    '### twoseat',
    '',
    headline(outcome, scrub),
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Files reviewed | ${formatInt(plan.included.length)} |`,
    `| Diff characters | ${formatInt(plan.charsUsed)} of ${formatInt(plan.charBudget)} budgeted |`,
    `| Primary seat | \`${neutralizePathForComment(config.primaryModel)}\` |`,
    `| Second seat | ${
      config.secondSeatModel === null
        ? 'not configured'
        : `\`${neutralizePathForComment(config.secondSeatModel)}\``
    } |`,
    `| Prompt version | ${promptVersion} |`,
    ...costRows(input),
    `| Blocking | ${blockingCell(config)} |`,
    ...costNote(input),
    ...findingLines(outcome.kind === 'reviewed' ? outcome.findings : [], scrub),
    ...withheldLines(plan),
    ...discardedLines(outcome),
  ];

  return lines.join('\n');
}
