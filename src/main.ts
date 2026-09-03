/**
 * Action entry point.
 *
 * One rule governs this file: the step always succeeds. A crash, a bad input,
 * or an API failure produces an annotation, never a failed check. Blocking a
 * merge is reserved for the policy engine acting on real findings, so a
 * malfunction of the gate can never stop a pull request.
 */
import * as core from '@actions/core';
import * as github from '@actions/github';

import { parseConfig } from './config.js';
import { charBudgetForTokens, planDiffBudget } from './ingest/budget.js';
import { toDiffFiles } from './ingest/files.js';
import { assembleReviewPrompt, createRunNonce } from './prompt/assemble.js';
import { findReviewComment } from './render/comment.js';
import { renderSkeletonBody } from './render/skeleton.js';

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

  if (config.blockingDisabled && config.blockingDisabledReason !== null) {
    core.warning(`Blocking is disabled for this run: ${config.blockingDisabledReason}`);
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
    `Queued ${plan.included.length} file(s) using ${plan.charsUsed} of ${plan.charBudget} budgeted characters. Dropped ${plan.dropped.length}.`,
  );

  // Assembled but not yet sent anywhere. No seat calls a model in this release.
  const prompt = assembleReviewPrompt({ plan, nonce: createRunNonce() });

  core.info(
    `Prompt version ${prompt.promptVersion}, ${prompt.data.length} characters inside the data region.`,
  );

  await upsertSummaryComment(
    octokit,
    { owner, repo, number },
    renderSkeletonBody({ config, plan, promptVersion: prompt.promptVersion }),
  );

  core.setOutput('files-reviewed', plan.included.length);
  core.setOutput('files-dropped', plan.dropped.length);
  core.setOutput('prompt-version', prompt.promptVersion);
}

run().catch((error: unknown) => {
  // An annotation, not a failure. The gate never blocks on its own malfunction.
  core.error(`twoseat did not complete: ${describeError(error)}`);
});
