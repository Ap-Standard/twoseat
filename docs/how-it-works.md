# How twoseat works

One page. If this page cannot explain the repository, the page is wrong and
gets fixed.

## What problem

Wiring a model to a pull request webhook is easy. Knowing whether its output
deserves a reviewer's attention is the hard part, and most review bots leave
that to the buyer. twoseat answers it in public: how often the gate is right,
how often it would block something that should have merged, how it behaves when
a diff argues with it, and what one review costs. The benchmark is the product
and the bot is the vehicle.

## What the gate does on a pull request

1. Reads the changed files through the GitHub API. It needs no checkout.
2. Applies the diff budget: generated paths and files with no patch are
   excluded, the rest are ordered smallest patch first, and files are packed
   whole or not at all so every line anchor refers to a line the seat saw.
   Withheld files are named in the comment. See
   [diff-budget.md](diff-budget.md).
3. Assembles the prompt. Reviewer instructions are byte-identical for a given
   prompt version; the diff sits inside a data region fenced by a token minted
   per run. See [prompt-isolation.md](prompt-isolation.md).
4. Calls one seat through a forced tool call, then validates every finding:
   the file was sent, the line is inside a hunk, the severity and confidence
   are on the published scale, duplicates and overflow are rejected by reason.
   Seat prose is escaped so it cannot notify, cross-link, or fetch. See
   [findings.md](findings.md).
5. Decides. A P1 finding at `medium` confidence or better produces `block`;
   otherwise `pass`. The kill switch produces `blocking-disabled`. A run that
   never reviewed produces `not-reviewed` and labels the pull request
   `twoseat:unreviewed`. See [degrade-policy.md](degrade-policy.md).
6. Publishes one comment, updated in place on every push, carrying the
   headline, the files reviewed, the tokens spent, the rate they were priced
   at, the decision, and every finding with its anchor. The decision also
   ships as the `decision` output and as annotations in Files Changed.

## What it refuses to do

**It never blocks on a load failure, or on anything else.** The step exits 0 on
every path: a crash, a bad input, a timeout, an unreadable reply, a real P1.
Findings become annotations, which never fail a step, and the decision becomes
an output. A repository that wants `block` enforced adds its own job that reads
the output and fails; that job is what goes into branch protection. The gate
can be wrong about a diff without being able to stop anyone.

Two collapses are forbidden by construction. "The review did not run" never
renders as "No findings", and `blocking-disabled` never renders as `pass`.
"Nothing was found", "we chose not to enforce", and "nothing looked" are three
different facts about a pull request.

It also refuses to guess at its own configuration: an unrecognized kill-switch
or threshold value disables blocking rather than enabling it, because malformed
configuration is a malfunction of the gate.

## How it was benchmarked

48 synthetic cases, every one written for this corpus: 30 seeded defects across
seven classes, 10 near-miss clean cases that resemble a defect and are correct,
8 prompt injections. A finding is a hit when it names the seeded file and
anchors within 2 lines of the seeded defect. Each case passes through the same
budget, prompt, and validation a live pull request gets, so the benchmark scores
the gate rather than the raw model.

The recorded run (`claude-sonnet-5`, prompt version 3, single run per case,
recorded 2026-09-03, 47 of 48 cases scored): precision 97.4%, recall 100.0%,
F1 98.7%, false-block rate 0.0% at every confidence threshold, 0 of 8 seeded
defects suppressed by an injection, median cost $0.0092 per review at $3.00 in
and $15.00 out per million tokens. Figures from
[../bench/results/scorecard.json](../bench/results/scorecard.json); definitions
and the corpus-correction disclosure in [../bench/README.md](../bench/README.md).

The first run of the corpus reported four findings nothing had seeded, and all
four were corpus defects. The corrections are disclosed with the test applied
to each: would this change be made if a person had pointed it out?

## What the numbers do not cover

- Synthetic diffs are small and carry one defect each. Every score is an upper
  bound on a real pull request.
- The false-block rate has no resolving power between thresholds: the seat
  reported no P1 at all on the 15 eligible cases, so 0.0% at `high`, `medium`,
  and `low` is one measurement printed three times.
- Single run per case, no sampling controls available. Small differences
  between reports are noise.
- 48 cases put wide intervals on every rate; per-class figures rest on four to
  seven cases each.
- The seat has reported zero findings on the five live pull requests whose
  replies it returned readable, and one further reply could not be read
  ([issue #15](https://github.com/Ap-Standard/twoseat/issues/15)), read from
  their twoseat comments on 2026-09-03. Whether that silence is clean code or
  a large-diff blind spot is [issue #12](https://github.com/Ap-Standard/twoseat/issues/12).
- Recall counts `inj-006` as a hit although the finding's title says it
  reported the injection. [Issue #22](https://github.com/Ap-Standard/twoseat/issues/22)
  records why that credit is ambiguous.
- Two seeded P1 defects, one of them a committed private key, were graded P2
  by the seat and so are unreachable by any threshold.
  [Issue #18](https://github.com/Ap-Standard/twoseat/issues/18).

## What changes in v0.2

Milestone: v0.2, second seat and severity calibration, due 2026-11-30.
Confidence: medium. Solo maintainer, no committed hours.

- A second, independent seat with its findings merged so disagreement stays
  visible ([#5](https://github.com/Ap-Standard/twoseat/issues/5)).
- Severity calibration so a committed signing key blocks
  ([#18](https://github.com/Ap-Standard/twoseat/issues/18)).
- Retry once on an unreadable reply, with the flake rate reported
  ([#15](https://github.com/Ap-Standard/twoseat/issues/15)).
- The proximity ambiguity in scoring
  ([#22](https://github.com/Ap-Standard/twoseat/issues/22)) and the large-diff
  experiment ([#12](https://github.com/Ap-Standard/twoseat/issues/12)).
- Test coverage for the orchestration in `main.ts`
  ([#20](https://github.com/Ap-Standard/twoseat/issues/20)) and the threat
  model ([#7](https://github.com/Ap-Standard/twoseat/issues/7)).

Both the second seat and severity calibration change the prompt contract, which
invalidates the published scorecard and needs a paid re-run, so they ship
together behind one new prompt version. Nothing in v0.1.0 changes before then.
