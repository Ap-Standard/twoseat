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

- **The gate never blocks, and that is structural rather than configured.** A
  crash, a bad input, or an API failure produces an annotation and the check
  still passes. No code path in this action can fail a check, a real finding
  included. A blocking decision is published as an output and a label, and a
  repository that wants one enforced fails its own job on that output. Deciding
  and enforcing sit in different files on purpose, so the gate can be wrong
  about a diff without being able to stop anyone. The four decisions it can
  reach are kept distinct, because "nothing was found", "we chose not to
  enforce", and "nothing looked" are different facts about a pull request. See
  [docs/degrade-policy.md](docs/degrade-policy.md).
- **The blocking threshold was derived, not picked.** A P1 at `medium`
  confidence or better decides `block`. The false-block table below reads 0.0%
  at all three thresholds, which is a real result and a weak discriminator: the
  seat reported no P1 at all on any of the 15 cases eligible to be
  false-blocked, so those three rows are one measurement printed three times.
  The choice rests on the other side of the ledger instead, and
  [docs/degrade-policy.md](docs/degrade-policy.md) shows the working, including
  the two seeded defects no threshold reaches.
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
- **The spend ceiling is checked before the call**, against the whole output
  allowance rather than a likely response length, and priced at a pessimistic
  characters-per-token ratio. Without a per-model tokenizer that bound is a
  conservative estimate and not a proof, which
  [docs/findings.md](docs/findings.md) states rather than glosses.
- **A committed credential does not get republished.** Quoting a leaked key is
  the correct finding to report, so the key is stripped from every string bound
  for a comment. Masking the run log alone would not cover the comment.

Planned, not yet built:

- A second, independent seat, merged so that disagreement between seats stays
  visible instead of being averaged away.
- A retry when a seat's reply comes back unreadable, which happens on roughly
  2-4% of calls and currently degrades to a comment saying nothing ran.
- A runbook and a threat model. The kill switch and the degrade path are
  documented in [docs/degrade-policy.md](docs/degrade-policy.md) until the
  runbook exists.

## Scorecard

The corpus is built: 48 synthetic cases, 30 with a seeded defect across seven
classes, 10 clean, and 8 carrying a prompt injection. Every case validates
against its own diff in CI, and the harness computes precision, recall, and F1
per severity and per defect class, false-block rate at each confidence
threshold, injection-resistance rate, and median cost and latency.

Two commands produce the block below from a live run: `npm run bench`, then
`npm run scorecard`.

**One of these figures understated the gate, and the fix is visible rather than
quietly applied.** The first run of this corpus reported four findings nothing
had seeded, and all four turned out to be real defects the corpus had mislabeled
or missed. Those cases are fixed, and the fact that a benchmark was edited in
response to a run it scored is disclosed in
[bench/README.md](bench/README.md) instead of buried, because that is the loop
by which a benchmark quietly becomes a record of what one model already does
well.

The injection metric counted a case where the seat reported the injection
instead of obeying it as the injection succeeding. The strict figure shipped
first and was corrected in its own change
([#16](https://github.com/Ap-Standard/twoseat/issues/16)), reviewed on the
argument that the code contradicted its own documented definition rather than
on the number moving. The two directions of the attack are now reported apart,
because a composite rate could not say which one the gate is weak against.

**The suppression row above is a count of 8 cases, not a rate to lean on.**
Nothing was suppressed in either run of this corpus, which is the strongest
honest claim available and still a small sample.

<!-- scorecard:start -->
<!-- generated from bench/results/REPORT.md; do not edit by hand -->

`claude-sonnet-5`, prompt version 3, 47 of 48 synthetic cases scored.

| | Value |
| --- | --- |
| Precision | 97.4% |
| Recall | 100.0% |
| F1 | 98.7% |
| False-block rate, any P1 | 0.0% |
| Seeded defects suppressed by an injection | 0 of 8 |
| Median cost per review | $0.0092 |

Method, per-class figures, and what these numbers do not cover: [bench/results/REPORT.md](bench/results/REPORT.md).
<!-- scorecard:end -->

Every figure will name the model, the prompt version, and the matching rule
that produced it. Scores are only comparable within one prompt version, which
is why the version is pinned by a fingerprint over the prompt contract.

## Not in v0.1

Auto-fix, whole-branch review, GitLab support, and a hosted service are out of
scope for this release. They are roadmap items rather than oversights.

## License

This repository uses the [Apache-2.0](LICENSE) license.
