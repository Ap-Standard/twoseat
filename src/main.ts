/**
 * Action entry point.
 *
 * One rule governs this file: the step always succeeds. A crash, a bad input,
 * an API failure, or a real finding produces an annotation, never a failed
 * check. A blocking decision is published as an output for a workflow to act
 * on, so no malfunction of the gate can stop a pull request. The policy behind
 * that decision is in docs/degrade-policy.md.
 *
 * A run that could not review says so in its comment. Reporting a failed seat
 * as a clean review is the one outcome this file must never produce, because it
 * tells a reviewer the diff was checked when nothing checked it.
 */
import * as core from '@actions/core';
import * as github from '@actions/github';

import { parseConfig } from './config.js';
import { charBudgetForTokens, planDiffBudget } from './ingest/budget.js';
import { toDiffFiles } from './ingest/files.js';
import { syncUnreviewedLabel, type LabelClient } from './labels.js';
import { decidePolicy, wantsUnreviewedLabel } from './policy.js';
import { assembleReviewPrompt, createRunNonce } from './prompt/assemble.js';
import { findReviewComment } from './render/comment.js';
import { renderReviewBody, type ReviewOutcome } from './render/review.js';
import { runReview } from './run-review.js';

type Octokit = ReturnType<typeof github.getOctokit>;

interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function upsertSummaryComment(
  octokit: Octokit,
  pr: PullRequestRef,
  body: string,
): Promise<void> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: pr.owner,
    repo: pr.repo,
    issue_number: pr.number,
    per_page: 100,
  });

  const existing = findReviewComment(comments);

  if (existing === null) {
    await octokit.rest.issues.createComment({
      owner: pr.owner,
      repo: pr.repo,
      issue_number: pr.number,
      body,
    });
    return;
  }

  await octokit.rest.issues.updateComment({
    owner: pr.owner,
    repo: pr.repo,
    comment_id: existing.id,
    body,
  });
}

/** Binds the label operations to one pull request. The rules are in labels.ts. */
function labelClient(octokit: Octokit, pr: PullRequestRef): LabelClient {
  return {
    add: async (name) => {
      await octokit.rest.issues.addLabels({
        owner: pr.owner,
        repo: pr.repo,
        issue_number: pr.number,
        labels: [name],
      });
    },
    remove: async (name) => {
      await octokit.rest.issues.removeLabel({
        owner: pr.owner,
        repo: pr.repo,
        issue_number: pr.number,
        name,
      });
    },
  };
}

/**
 * Puts findings on the lines they belong to.
 *
 * Annotations do not fail a step, so this surfaces a finding in the Files
 * Changed view without blocking anything.
 */
function annotate(outcome: ReviewOutcome): void {
  if (outcome.kind !== 'reviewed') {
    core.warning(`twoseat did not review this diff: ${outcome.reason}`);
    return;
  }

  for (const finding of outcome.findings) {
    const properties = { file: finding.path, startLine: finding.line };
    const message = `${finding.severity} ${finding.title}: ${finding.detail}`;

    if (finding.severity === 'P1') {
      core.error(message, properties);
    } else {
      core.warning(message, properties);
    }
  }
}

async function run(): Promise<void> {
  // pull_request_target is deliberately unsupported: it runs with repository
  // secrets against a fork's diff, and the diff is untrusted input.
  if (github.context.eventName !== 'pull_request') {
    const received = github.context.eventName || 'none';
    core.warning(
      `twoseat supports the pull_request event only, received "${received}". Nothing to review.`,
    );
    return;
  }

  const config = parseConfig((name) => core.getInput(name));

  if (config.apiKey !== null) {
    // Registered before the key can reach any log line, so an accidental echo
    // is masked. Actions logs on a public repository are public.
    core.setSecret(config.apiKey);
  }

  if (config.blockingDisabled && config.blockingDisabledReason !== null) {
    core.warning(`Blocking is disabled for this run: ${config.blockingDisabledReason}`);
  }

  if (config.apiKey !== null && config.tokenPrices === null) {
    // The dollar ceiling looks like a live limit because it has a default, and
    // it cannot run without rates. Say so in the log as well as the comment,
    // since whoever is paying reads one and not always the other.
    core.warning(
      'This run spends money with no dollar ceiling: cost-ceiling-usd cannot be ' +
        'enforced without input-price-per-mtok and output-price-per-mtok. The ' +
        'token ceiling still applies.',
    );
  }

  const octokit = github.getOctokit(core.getInput('github-token', { required: true }));
  const { owner, repo, number } = github.context.issue;

  const apiFiles = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: number,
    per_page: 100,
  });

  const plan = planDiffBudget(toDiffFiles(apiFiles), {
    charBudget: charBudgetForTokens(config.tokenCeiling),
  });

  core.info(
    `Queued ${String(plan.included.length)} file(s) using ${String(plan.charsUsed)} of ${String(plan.charBudget)} budgeted characters. Dropped ${String(plan.dropped.length)}.`,
  );

  const prompt = assembleReviewPrompt({ plan, nonce: createRunNonce() });
  const outcome = await runReview(config, plan, prompt);

  annotate(outcome);

  // Decided once. The comment, the outputs, and the label all read this value,
  // so they cannot report different verdicts on the same run.
  const decision = decidePolicy(outcome, config);

  await upsertSummaryComment(
    octokit,
    { owner, repo, number },
    renderReviewBody({ config, plan, promptVersion: prompt.promptVersion, decision, outcome }),
  );

  const labelWarning = await syncUnreviewedLabel(
    labelClient(octokit, { owner, repo, number }),
    wantsUnreviewedLabel(decision.decision),
  );
  if (labelWarning !== null) {
    core.warning(labelWarning);
  }

  const findings = outcome.kind === 'reviewed' ? outcome.findings : [];

  core.setOutput('files-reviewed', plan.included.length);
  core.setOutput('files-dropped', plan.dropped.length);
  core.setOutput('prompt-version', prompt.promptVersion);
  core.setOutput('reviewed', outcome.kind === 'reviewed');
  core.setOutput('findings', findings.length);
  core.setOutput('findings-p1', findings.filter((finding) => finding.severity === 'P1').length);
  core.setOutput('decision', decision.decision);
  core.setOutput('blocking-findings', decision.blockingFindings);
  core.setOutput(
    'estimated-cost-usd',
    outcome.kind === 'reviewed' && outcome.cost !== null ? outcome.cost.usd.toFixed(4) : '',
  );
}

run().catch((error: unknown) => {
  // An annotation, not a failure. The gate never blocks on its own malfunction.
  core.error(`twoseat did not complete: ${describeError(error)}`);
});
