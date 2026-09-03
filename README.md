# twoseat

A measured AI code-review gate for GitHub pull requests. The benchmark is the
product and the bot is the vehicle.

## Status

**v0.1 in progress.** This release ingests a pull request diff, applies a
documented truncation strategy, and maintains one summary comment. It does not
call a model yet. No scorecard is published yet, and none will be until the
harness in `bench/` can regenerate it from a labeled corpus.

## Why this exists

Wiring a model to a pull request webhook is easy. Knowing whether the output
deserves a reviewer's attention is the hard part, and it is the part most review
bots leave to the buyer. This one is built to answer it in public: how often the
gate is right, how often it blocks something that should have merged, how
resistant it is to instructions hidden in a diff, and what one review costs.

## Design commitments

Live in this release:

- **The gate never blocks on its own malfunction.** A crash, a bad input, or an
  API failure produces an annotation and the check still passes. Blocking a
  merge is reserved for policy decisions about real findings.
- **Truncation is whole file or nothing.** A partial patch shifts line anchors,
  and a finding on the wrong line reads as an invented one. Files that do not
  fit are named in the comment rather than dropped silently. See
  [docs/diff-budget.md](docs/diff-budget.md).
- **One comment per pull request, updated in place.** A bot that appends a
  comment per push trains reviewers to ignore it.
- **Deletions stay in scope.** Removing a guard is a change worth reviewing, so
  the budget keeps deletion-only patches instead of discarding them.

Planned, not yet built:

- The diff reaches a seat structurally fenced and separated from reviewer
  instructions, with adversarial cases proving that text in a diff cannot alter
  reviewer behavior.
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
