# twoseat

A measured AI code-review gate for GitHub pull requests. The benchmark is the
product and the bot is the vehicle.

## Status

**v0.1 in progress.** This release ingests a pull request diff, applies a
documented truncation strategy, reviews it with one seat, and maintains one
summary comment carrying the findings, the tokens spent, and the prompt version
behind them. A second seat is not built yet. No scorecard is published yet, and
none will be until the harness in `bench/` can regenerate it from a labeled
corpus.

## Why this exists

Wiring a model to a pull request webhook is easy. Knowing whether the output
deserves a reviewer's attention is the hard part, and it is the part most review
bots leave to the buyer. This one is built to answer it in public: how often the
gate is right, how often it blocks something that should have merged, how
resistant it is to instructions hidden in a diff, and what one review costs.

## Design commitments

Live in this release:

- **The gate never blocks on its own malfunction.** A crash, a bad input, or an
  API failure produces an annotation and the check still passes. No code path in
  this release can fail a check at all. When the policy engine lands, a decision
  about a real finding will be the only thing that can.
- **Truncation is whole file or nothing.** A partial patch shifts line anchors,
  and a finding on the wrong line reads as an invented one. Files that do not
  fit are named in the comment rather than dropped silently. See
  [docs/diff-budget.md](docs/diff-budget.md).
- **One comment per pull request, updated in place.** A bot that appends a
  comment per push trains reviewers to ignore it.
- **Deletions stay in scope.** Removing a guard is a change worth reviewing, so
  the budget keeps deletion-only patches instead of discarding them.
- **The diff is data, not instructions.** Diff content sits inside a region
  whose delimiters carry a random token minted per run, so content cannot forge
  its way out into the instruction region. Reviewer instructions are
  byte-identical no matter what a diff contains, and the prompt is versioned.
  See [docs/prompt-isolation.md](docs/prompt-isolation.md).
- **A seat's reply is untrusted too.** A finding is published only when its
  anchor lands inside a hunk the run actually sent, so a seat cannot report on a
  file it never saw or a line the diff never touched. Rejections are counted by
  reason in the comment rather than dropped quietly. Seat prose is escaped
  before it renders, so a finding cannot notify anyone, cross-link another
  repository, or fetch an external image when a reviewer opens the pull
  request. See [docs/findings.md](docs/findings.md).
- **Every figure names its method.** Token prices are workflow inputs rather
  than a table in this repository, because a committed rate goes stale without
  failing anything. The comment reports the rate beside the cost, and says so
  plainly when no rate was supplied.
- **The spend ceiling is checked before the call**, against the most a run could
  cost rather than a likely response length.

Planned, not yet built:

- A measured injection-resistance rate. Isolation is structural today, and how a
  model behaves when a diff argues with it is unmeasured until the benchmark
  runs adversarial cases against a real seat.
- A second, independent seat, merged so that disagreement between seats stays
  visible instead of being averaged away.
- A labeled benchmark corpus, and a scorecard regenerated from it by one command.

## What the scorecard will report

Planned metrics, once the corpus exists: precision, recall, and F1 per severity
and per defect category; false-block rate; injection-resistance rate; and median
cost and latency per review. Every figure will name the model and prompt version
that produced it, and will be reproducible from this repository.

## Not in v0.1

Auto-fix, whole-branch review, GitLab support, and a hosted service are out of
scope for this release. They are roadmap items rather than oversights.

## License

This repository uses the [Apache-2.0](LICENSE) license.
