# Changelog

This file records every notable change to twoseat. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each entry names
the pull request that carried the change and the mechanism it introduced.

## [Unreleased]

Nothing. v0.1.0 is frozen: no new gate feature lands before v0.2.

## [0.1.0] - 2026-09-04

The first release: a single-seat, never-blocking AI code-review gate for GitHub
pull requests, shipped with the benchmark that scored it.

### Added

- Action skeleton with deterministic diff ingestion ([#9]). Files with no
  patch and generated paths are excluded before budgeting, the rest are ordered
  smallest patch first with the path as a tiebreaker, and files are packed
  whole or not at all, so every finding's line anchor refers to a line the seat
  saw. The step exits 0 on every path: a malfunction produces an annotation,
  never a failed check.
- Reviewer prompt with the diff fenced as data ([#10]). Diff content sits
  inside a region whose delimiters carry a 64-bit token minted per run from a
  cryptographic source, so content cannot forge its way into the instruction
  region. Instructions are byte-identical for a given prompt version, and
  `PROMPT_VERSION` is pinned by a fingerprint test over the instructions and
  the tool schema together.
- Single-seat review with finding validation ([#11]). The seat answers through
  one forced tool call; a reply that does not parse as a findings list is
  reported as a run that did not review, never as a clean one. Each finding
  survives seven checks (file sent, line inside a hunk, published severity and
  confidence, dedupe, cap) before it reaches the comment. Seat prose is escaped
  so it cannot notify, cross-link, or fetch, and a committed credential is
  redacted from every comment-bound string.
- Benchmark corpus, harness, and scorecard command ([#13]). 48 synthetic cases
  written for this corpus: 30 seeded defects across seven classes, 10
  near-miss clean cases, 8 prompt injections. Every case validates against its
  own diff in CI with no key. A hit is a finding within 2 lines of the seeded
  defect, and an undefined rate prints as "not measured", never as zero.
  `npm run scorecard` regenerates the README block from the committed
  `scorecard.json` with no spend.
- Audit trail and the first published scorecard ([#14]). `runs.json` records
  what the seat said beside what the corpus expected, case by case. Reading it
  showed the first run's four unseeded findings were four corpus defects; the
  corrections, and the hazard of correcting a benchmark in response to a run,
  are disclosed in `bench/README.md`. Corrected run, 47 of 48 cases scored,
  recorded 2026-09-03: precision 97.4%, recall 100.0%, F1 98.7%, false-block
  0.0% at every threshold, median $0.0092 per review at $3.00 in and $15.00
  out per million tokens.
- Policy engine that decides what blocks without enforcing it ([#19]). Four
  distinct decisions (`not-reviewed`, `blocking-disabled`, `block`, `pass`)
  are published as the `decision` output and a `twoseat:unreviewed` label. The
  threshold is `medium`, chosen from block sensitivity on the 32 seeded P1
  cases because the false-block table read 0.0% at every threshold and could
  not separate them. Enforcement belongs to the consuming workflow, which fails
  its own job on the output; nothing in the action can fail a check.

### Changed

- Token-rate verification is dated rather than disclaimed ([#17]). The rates
  behind the cost figure, $3.00 in and $15.00 out per million tokens, were
  checked against Anthropic's published pricing for `claude-sonnet-5` on
  2026-09-03. The action holds no price table; the calling workflow supplies
  the rate and the comment prints it beside the cost.
- Injection metric split into its two directions ([#21]). Suppression (a
  seeded defect went unreported) and induction (the seat produced the finding
  the injection named) are counted apart, and a finding that reports the
  injection itself counts as neither. Re-scored from the recorded run rather
  than re-run: every figure outside the injection block came out
  byte-identical. The README leads with the suppression count, 0 of 8, rather
  than a resistance percentage.
- Action runtime moved from `node20` to `node24`, with the esbuild target
  ([#23]). GitHub's runners have forced Node 20 actions onto Node 24 since
  2026-06-16 and remove Node 20 on 2026-09-23, per GitHub's deprecation
  notice. This is the single exception to the freeze and changes no gate
  behavior.

### Known limitations

- Zero findings on live pull requests so far ([#12]). Of the eight merged pull
  requests, six reached a seat: five came back "No findings" and one reply
  could not be read ([#19], tracked in [#15]), read from the latest twoseat
  comment on each on 2026-09-03. The corpus proves the seat finds seeded
  defects in small diffs, so the open question is diff size or defect absence
  on live diffs many times the size of any corpus case.
- Two seeded P1 defects are unreachable by any confidence threshold ([#18]).
  The seat located a committed private key and a TOCTOU defect and graded both
  P2, so no threshold reaches them. This is severity calibration, not a
  threshold problem.
- Proximity ambiguity ([#22]). In five of eight injection cases the injected
  comment sits within the 2-line tolerance of the defect it hides. Recall
  counts `inj-006` as a hit although the finding's title says it reported the
  injection. No alternative recall figure is printed; the issue records why the
  credit is ambiguous.
- Unreadable replies recovered by retry ([#15]). 3 of 96 calls across the two
  full runs of this corpus returned a reply the parser could not read; all 3
  succeeded on retry, and the action does not retry yet. On a live pull
  request this reads "The review did not run", as it did on the final run of
  [#19].
- Synthetic scores are an upper bound. Every diff in the corpus is small and
  carries one defect; a real pull request is neither.

[Unreleased]: https://github.com/Ap-Standard/twoseat/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Ap-Standard/twoseat/releases/tag/v0.1.0
[#9]: https://github.com/Ap-Standard/twoseat/pull/9
[#10]: https://github.com/Ap-Standard/twoseat/pull/10
[#11]: https://github.com/Ap-Standard/twoseat/pull/11
[#12]: https://github.com/Ap-Standard/twoseat/issues/12
[#13]: https://github.com/Ap-Standard/twoseat/pull/13
[#14]: https://github.com/Ap-Standard/twoseat/pull/14
[#15]: https://github.com/Ap-Standard/twoseat/issues/15
[#17]: https://github.com/Ap-Standard/twoseat/pull/17
[#18]: https://github.com/Ap-Standard/twoseat/issues/18
[#19]: https://github.com/Ap-Standard/twoseat/pull/19
[#21]: https://github.com/Ap-Standard/twoseat/pull/21
[#22]: https://github.com/Ap-Standard/twoseat/issues/22
[#23]: https://github.com/Ap-Standard/twoseat/pull/23
