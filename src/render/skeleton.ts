/**
 * The comment this release posts.
 *
 * It deliberately says that no model review has run. A gate that posts an
 * empty-looking review before it can actually review teaches reviewers that a
 * clean comment means "no problems found", which would be false.
 */
import type { Config } from '../config.js';
import type { BudgetPlan, DropReason } from '../ingest/budget.js';
import { COMMENT_MARKER } from './comment.js';

export interface SkeletonCommentInput {
  config: Config;
  plan: BudgetPlan;
}

const DROP_REASONS: Record<DropReason, string> = {
  binary: 'binary, no patch to review',
  generated: 'generated file',
  'over-budget': 'over the diff budget',
};

function blockingCell(config: Config): string {
  if (!config.blockingDisabled) {
    return 'enabled';
  }
  return `disabled (${config.blockingDisabledReason ?? 'no reason recorded'})`;
}

export function renderSkeletonBody({ config, plan }: SkeletonCommentInput): string {
  const lines: string[] = [
    COMMENT_MARKER,
    '### twoseat',
    '',
    'No model review has run. This release ingests the pull request diff and',
    'reports what a review would have been given. Findings arrive in a later release.',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Files queued for review | ${plan.included.length} |`,
    `| Diff characters | ${plan.charsUsed} of ${plan.charBudget} budgeted |`,
    `| Primary seat | \`${config.primaryModel}\` |`,
    `| Second seat | ${config.secondSeatModel === null ? 'not configured' : `\`${config.secondSeatModel}\``} |`,
    `| Blocking | ${blockingCell(config)} |`,
  ];

  if (plan.dropped.length > 0) {
    lines.push('', `**Not sent to a seat (${plan.dropped.length}):**`, '');
    for (const file of plan.dropped) {
      lines.push(`- \`${file.path}\` (${DROP_REASONS[file.reason]}, ${file.chars} characters)`);
    }
  }

  return lines.join('\n');
}
