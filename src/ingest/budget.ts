/**
 * Diff budgeting.
 *
 * A review run has a finite prompt budget, so large pull requests must be cut
 * down before the diff reaches a seat. The strategy is deterministic: the same
 * pull request always produces the same plan, which is what makes benchmark
 * numbers reproducible. See docs/diff-budget.md for the published rules.
 */

/** The statuses the pull request files API documents. */
export type DiffFileStatus =
  | 'added'
  | 'modified'
  | 'removed'
  | 'renamed'
  | 'copied'
  | 'changed'
  | 'unchanged';

export interface DiffFile {
  path: string;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  /** Absent when the API returns no patch: binary files, and very large ones. */
  patch?: string;
}

export type DropReason = 'no-patch' | 'generated' | 'over-budget';

/**
 * Paths whose contents are produced by a tool rather than written by a person.
 * Reviewing them wastes budget and produces findings nobody can act on, so they
 * are excluded before budgeting. The list is deliberately conservative: when a
 * pattern is ambiguous, the file stays reviewable.
 */
const GENERATED_PATH_PATTERNS: readonly RegExp[] = [
  // Dependency lockfiles.
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$/,
  /(^|\/)(Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/,
  // Build output and vendored trees.
  /(^|\/)(dist|build|vendor|node_modules)\//,
  // Minified bundles and sourcemaps.
  /\.min\.(js|css)$/,
  /\.map$/,
  // Test snapshots.
  /(^|\/)__snapshots__\//,
  /\.snap$/,
];

function isGeneratedPath(path: string): boolean {
  return GENERATED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

export interface IncludedFile {
  path: string;
  patch: string;
  chars: number;
}

export interface DroppedFile {
  path: string;
  reason: DropReason;
  chars: number;
}

export interface BudgetOptions {
  charBudget: number;
}

export interface BudgetPlan {
  included: IncludedFile[];
  dropped: DroppedFile[];
  charBudget: number;
  charsUsed: number;
}

/**
 * Approximate characters per token. The action budgets in characters because
 * counting real tokens would require a per-model tokenizer, and the ratio only
 * needs to be good enough to keep a request under the model's window.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Share of the token ceiling available to diff content. The remainder is
 * headroom for reviewer instructions and the model's own response.
 */
export const DIFF_TOKEN_SHARE = 0.7;

export function charBudgetForTokens(tokenCeiling: number): number {
  return Math.max(0, Math.floor(tokenCeiling * DIFF_TOKEN_SHARE * CHARS_PER_TOKEN));
}

/**
 * Characters to tokens, rounded up. Used to price a request before it is sent,
 * where an undercount would let a run exceed the ceiling it was given.
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);
}

/**
 * Share of the token ceiling a seat may spend on its reply. The rest of the
 * headroom left by DIFF_TOKEN_SHARE covers the reviewer instructions.
 */
export const OUTPUT_TOKEN_SHARE = 0.1;

/** Floor on the response allowance, so a small ceiling still permits a reply. */
export const MIN_OUTPUT_TOKENS = 1024;

export function outputTokenBudget(tokenCeiling: number): number {
  return Math.max(MIN_OUTPUT_TOKENS, Math.floor(tokenCeiling * OUTPUT_TOKEN_SHARE));
}

/** Codepoint ordering, so the plan does not vary with the runner's locale. */
function byPath(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function planDiffBudget(
  files: readonly DiffFile[],
  options: BudgetOptions,
): BudgetPlan {
  const included: IncludedFile[] = [];
  const dropped: DroppedFile[] = [];
  let charsUsed = 0;

  // Step one: exclude what cannot or should not be reviewed. This happens
  // before budgeting so an excluded file never displaces a reviewable one.
  const reviewable: DiffFile[] = [];
  for (const file of [...files].sort((a, b) => byPath(a.path, b.path))) {
    // Path first. The API omits patches for very large files as well as binary
    // ones, and a lockfile is routinely large enough to hit that. Reporting a
    // lockfile as "no patch" is true and useless; "generated" is why nobody
    // wants it reviewed.
    if (isGeneratedPath(file.path)) {
      dropped.push({ path: file.path, reason: 'generated', chars: file.patch?.length ?? 0 });
    } else if (file.patch === undefined) {
      dropped.push({ path: file.path, reason: 'no-patch', chars: 0 });
    } else {
      reviewable.push(file);
    }
  }

  // Step two: smallest patches first. This maximizes the number of files a run
  // actually reviews and stops one oversized file from starving those behind it.
  const ordered = reviewable.sort((a, b) => {
    const sizeDelta = (a.patch?.length ?? 0) - (b.patch?.length ?? 0);
    return sizeDelta !== 0 ? sizeDelta : byPath(a.path, b.path);
  });

  for (const file of ordered) {
    const patch = file.patch ?? '';
    const chars = patch.length;

    // Whole file or nothing. A partial patch shifts line anchors, and findings
    // anchored to the wrong line read as hallucinations.
    if (charsUsed + chars <= options.charBudget) {
      included.push({ path: file.path, patch, chars });
      charsUsed += chars;
    } else {
      dropped.push({ path: file.path, reason: 'over-budget', chars });
    }
  }

  return { included, dropped, charBudget: options.charBudget, charsUsed };
}
