# The policy and the degrade path

What this gate decides, what it refuses to decide, and what happens when it
breaks. `src/policy.ts` implements this file and cites it.

One rule sits above everything below. **The action's step always exits 0.**
Nothing in the policy engine calls `core.setFailed`, and no failure of the gate
can stop a pull request. A gate that blocks when it malfunctions trains people
to route around it, and the first time it does that it stops being a measurement
and becomes an obstacle.

## The four decisions

Every run ends in exactly one of these, published as the `decision` output.

| Decision | When | Blocks |
| --- | --- | --- |
| `not-reviewed` | No seat produced a readable review | never |
| `blocking-disabled` | The kill switch is on, or set to a value the action cannot interpret | never |
| `block` | A seat reviewed the diff and reported at least one P1 at or above the confidence threshold | this is the signal |
| `pass` | A seat reviewed the diff and reported no such finding | no |

They resolve in that order. A run that never reviewed has nothing to block on,
so it reports what happened rather than what would have been enforced.

**`blocking-disabled` never collapses into `pass`, and `not-reviewed` never
collapses into either.** "Nothing was found", "we chose not to enforce", and
"nothing looked" are three different facts about a pull request, and a consumer
that cannot tell them apart will read the third as the first. That is the
failure this project exists to avoid: a bug once rendered a malformed payload as
"No findings", which told a reviewer the diff was checked when nothing checked
it.

The `blocking-findings` output carries the count of P1 findings at or above the
threshold, and it is computed even when the kill switch is on. The count is the
measurement and the decision is the policy applied to it. Turning off
enforcement does not erase the evidence.

## What degrades, and to what

Every one of these ends the run at `not-reviewed` with a reason in the comment,
and none of them is an error:

- No API key reached the run. This is the expected state for a pull request from
  a fork, since forks receive no repository secrets.
- The diff contains no file the gate can review.
- The run would have cost more than `cost-ceiling-usd`, checked before the seat
  is called against the most the call could cost.
- The seat returned an error, or did not answer inside `DEFAULT_TIMEOUT_MS`
  (120 seconds). A hung call aborts rather than holding the job open.
- The seat answered with something the parser could not read as a findings list.

The pull request is labeled `twoseat:unreviewed` when a run ends here, and the
label is removed by the next run that does review. A stale label is a lie about
the current state of the branch.

Labeling can fail on its own, most likely on a permissions problem. When it
does, the run warns and carries on. A gate that fails because it could not
annotate itself is blocking on its own malfunction through a side door.

## The confidence threshold

**`medium`.** A P1 finding at `medium` or `high` confidence produces `block`. A
P1 at `low` does not.

The default is set by `blocking-confidence`. Changing it means leaving the
calibration below, which is the reason it is an input and not a constant.

### How the number was chosen

Calibrated against the 47 scored cases of
[the corpus](../bench/README.md), prompt version 3, contract fingerprint
`262321adcfff2863`, `claude-sonnet-5`. Read
[the report](../bench/results/REPORT.md) beside this.

**The false-block table cannot choose a threshold, and it is important to say
why rather than to quote its 0.0%.** Across all 15 eligible cases the seat
reported zero P1 findings at any confidence. Five findings on those cases, every
one P2. The three rows of that table are not three measurements that happen to
agree. They are one measurement reported three times, and the quantity a
threshold filters never occurred. Nothing there favors any threshold.

The evidence that does discriminate is the other side of the ledger: of the 32
cases carrying a seeded P1, how many a policy would actually block.

| Threshold | Blocks | Rate |
| --- | --- | --- |
| P1 at `high` | 26 of 32 | 81.2% |
| P1 at `medium` | 30 of 32 | 93.8% |
| P1 at `low` | 30 of 32 | 93.8% |

**`low` is dominated.** No P1 finding in the entire run carried `low`
confidence, so on this corpus `low` and `medium` are the same policy. It buys
nothing that was measured and widens the door to a class of finding the corpus
never produced.

**`high` exempts a defect class.** The four cases it gives up are `inj-008`,
`migration-001`, `migration-002` and `migration-004`. Every one is
`unsafe-migration`, and every one correctly located the seeded defect. The seat
is systematically less confident on migration defects and was right each time it
was less confident. A threshold that quietly excuses the corpus's largest defect
class is worse than one chosen on a silent axis.

So `medium`, because the harm side is silent and the benefit side is not.

### What this calibration does not cover

**Synthetic diffs are cleaner than real ones.** `bench/README.md` states that
every score there is an upper bound on real pull requests. The false-block rate
is the figure most likely to be optimistic, and it is also the one with no
resolving power here. A repository that turns on real enforcement should expect
to learn something this corpus could not tell it.

**Two seeded P1 defects are unreachable by any threshold.** In `inj-006` and
`secret-002` the seat located the defect and graded it P2, so no confidence
setting reaches them. `secret-002` is a committed private key. As specified,
this policy would not block a committed signing key, and the fix is severity
calibration rather than a threshold. Tracked separately.

**The calibration is stale the moment the prompt version, the model, or the
corpus changes.** Scores compare only within one prompt version. A bump
invalidates the table above along with the published scorecard.

## The kill switch

`blocking-disabled`, conventionally fed from the repository variable
`TWOSEAT_BLOCKING_DISABLED`, turns blocking off for every run in the repository
as soon as the variable is set. No release and no code change.

Any recognized true value disables blocking. **So does any value the action
cannot interpret**, and the same rule governs an unrecognized
`blocking-confidence`. Malformed configuration is a malfunction of the gate, and
the gate does not guess at its own configuration. Failing the other way would
let a typo in a repository variable block every pull request in the repo.

The comment and the run log both name the reason blocking is off, so a disabled
gate never looks like a passing one.

## Who actually blocks a merge

**Not this action.** The step exits 0 on every path, including `block`.

A `block` decision is a published fact, not an enforcement action. It reaches
consumers three ways: the `decision` output, the `blocking-findings` count, and
a `core.error` annotation on the offending line, which GitHub renders in the
Files Changed view without failing anything.

A repository that wants a `block` decision to actually stop a merge reads the
output in its own workflow and fails its own job:

```yaml
- id: review
  uses: Ap-Standard/twoseat@v0.1.0
  with:
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    primary-model: claude-sonnet-5

- name: enforce the review policy
  if: steps.review.outputs.decision == 'block'
  run: |
    echo "twoseat reported ${{ steps.review.outputs.blocking-findings }} blocking finding(s)."
    exit 1
```

That job is the thing to add to branch protection, not the review step.

**The separation is the point.** Deciding and enforcing are different acts, and
putting them in different files means the gate can be wrong about a diff without
being able to stop anyone. It also puts the choice to enforce in the hands of
the repository that lives with the consequences, in a file its owners control,
rather than in an action they installed.

The action never publishes a check run of its own. That would let branch
protection require it by name with no second job, and it would need
`checks: write` from every consumer to put a failing check authored by a gate
that does not block on a pull request. The indirection above is worth its one
extra step.
