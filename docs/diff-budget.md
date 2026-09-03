# Diff budget and truncation

A model call accepts a finite prompt, so large pull requests need cutting down
before the diff reaches a seat. How they get cut has to be deterministic: the
same pull request must always produce the same plan, or the benchmark numbers
this project plans to publish cannot be reproduced.

No model call runs yet. The budget described here is live, and it already decides
what a review would be given.

## The budget

`token-ceiling` (default 120000) sets the prompt tokens one review may consume.
The diff receives 70 percent of that. The remainder is headroom for reviewer
instructions and the model's own response. Characters are the working unit,
converted at 4 characters per token, so the default diff budget is 336000
characters.

Characters rather than tokens, because counting real tokens needs a per-model
tokenizer. The ratio needs to keep a request inside the model's
window, nothing more. It is not a billing estimate.

## The strategy

Four steps, in this order.

1. **Exclude generated files by path.** Lockfiles, build output, vendored trees,
   minified bundles, sourcemaps, and test snapshots. The patterns live in
   `src/ingest/budget.ts` and are deliberately conservative: an ambiguous path
   stays reviewable.
2. **Exclude files the API gave no patch for.** That covers binary files and
   very large ones. Path matching runs first because the API also omits the
   patch for a large lockfile, and reporting that file as "no patch" is true but
   tells a reviewer nothing. "Generated" is the reason nobody wanted it
   reviewed.
3. **Order what remains by patch size, smallest first**, with the file path as a
   tiebreaker. This maximizes the number of files a run reviews and stops one
   oversized file from starving everything behind it. Ordering compares
   codepoints, so a plan does not vary with the runner's locale.
4. **Pack whole files until the budget is spent.** A file that does not fit is
   dropped entirely.

## Whole file or nothing

A partially included patch shifts the line numbers a seat sees. A finding
anchored to the wrong line is indistinguishable from an invented one to the
person reading it, and it costs more trust than the missed finding would have.
So a file is either sent complete or not sent.

## What this costs

The gate skips an over-budget file entirely, and it does not hide that. Every
excluded file appears in the summary comment with its reason and its size, so a
reviewer can see the blind spot and decide what to do about it.

## Deletions stay reviewable

The budget keeps deletion-only patches like any other change. Removing an
authorization check or an input guard is exactly the kind of defect this gate
exists to catch. `src/ingest/budget.test.ts` holds a test that fails if a future
change starts excluding them.
