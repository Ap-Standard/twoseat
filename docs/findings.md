# Findings

A finding is a claim about a specific line of a specific file. This document
describes the shape of that claim, what the gate checks before publishing one,
and what it reports when a check fails.

## The scale

Two severities, deliberately. A longer scale invites argument about whether
something is a three or a four, and nothing downstream would act differently.

| Severity | Meaning |
| --- | --- |
| `P1` | Should stop a merge. |
| `P2` | Worth raising. Should not stop a merge. |

Confidence is separate, and reported as `high`, `medium`, or `low`. Severity
says how bad the defect would be. Confidence says how sure the seat is that it
is real. Collapsing the two would hide the difference between a certain style
nit and a suspected data-loss bug.

Every finding also carries the seat that reported it and the model id behind
that seat. Attribution is the point of two seats: a finding with no seat on it
cannot be scored per seat, and disagreement between seats disappears into an
average.

## Seat output is untrusted

A seat is given a diff that whoever opened the pull request wrote. Its reply is
therefore shaped by attacker-influenced input, and the reply lands in a comment
that real reviewers read. The gate treats seat output the same way it treats the
diff itself: as data to validate, not as a result to publish.

A seat cannot reply in prose. It is required to call one tool whose schema
declares every field, so a reply is parsed rather than interpreted. A reply the
action cannot parse is reported as a failure, never as a clean review.

## What is checked

Each entry has to survive all of this before it reaches a comment.

| Rejection | What it means |
| --- | --- |
| `malformed` | Not shaped like a finding: a field missing, wrong-typed, or empty. |
| `unknown-file` | Named a file the run never sent to a seat. |
| `unanchored-line` | Anchored to a line outside every hunk of that file. |
| `bad-severity` | Used a severity outside the two published values. |
| `bad-confidence` | Used a confidence outside the three published values. |
| `duplicate` | Same file, line, and title as an entry already accepted. |
| `over-limit` | Past the cap of 40 findings from one seat. |

The file check and the line check are separate rejections on purpose. "The seat
named a file we never sent" and "the seat missed the line" are different
failures, and a scorecard that merges them cannot tell you which one a prompt
change fixed.

### Anchor validation

The gate reads the hunk headers of the patch it sent and accepts a line only if
it falls inside one of them. A finding on a line the diff does not touch reads
as an invented one, which is the same reason truncation is whole file or nothing.
See [diff-budget.md](diff-budget.md).

Two details matter:

- **Content cannot widen its own range.** Every content line in a unified diff
  carries a leading `+`, `-`, or space, so a real hunk header is the only thing
  that can begin a line with `@@`. A diff that adds text shaped like a header
  does not extend the range a finding may anchor to.
- **The check fails closed.** A patch the parser cannot read yields no ranges,
  so every finding against it is rejected rather than published unverified.

A pure deletion adds no line to the new file. Those anchor to the line the
removal follows, which is the closest thing a reviewer can point at. A deletion
at the top of a file has no line above it and gets no anchor.

### Nothing is dropped quietly

The comment counts every rejection by reason. A gate that silently discards half
a review looks identical to a gate that found nothing, and a parser gap would
then be invisible instead of being a number someone can read.

## Seat prose in the comment

Findings are written by a seat, and they render into a comment on a real pull
request. Three things that text must not be able to do:

- **Notify anyone.** An at sign against a word character becomes an HTML entity,
  so a mention reads correctly to a person and pings nobody.
- **Reach another repository.** A hash against a digit gets the same treatment,
  so a cross-reference cannot attach this pull request to an unrelated issue.
- **Fetch anything.** The opening angle bracket is escaped, which disables every
  HTML tag, and the opening square bracket is escaped, which disables markdown
  links and images. Both are needed: markdown image syntax requires no angle
  bracket to make a reviewer's browser fetch an attacker's URL on page load, so
  escaping HTML alone leaves that beacon open. The second reviewer seat found
  exactly that gap after the first version of this document claimed the hole
  was closed.

The escapes run in a fixed order, and the order carries weight. Every numeric
entity introduced here contains a hash against a digit, which is precisely what
the cross-reference step matches, so any step that introduces one must run
after it. Getting that order wrong produced two separate bugs during this work,
so the property is now asserted directly instead of case by case.

Newlines collapse to spaces, so a finding cannot add its own headings or table
rows to a comment whose structure the action owns. Backtick runs shorten, so a
finding cannot open a code fence and swallow the rest. Control characters, zero
width marks, and bidirectional overrides are stripped. Titles cap at 160
characters and details at 800.

Escaping the opening angle bracket has a second effect worth naming: it makes
the action's own HTML comment marker unreproducible in seat text, so a finding
cannot plant a decoy marker for a later run to latch onto.

### The key is redacted here, not only masked

`core.setSecret` masks a value in the run log and does nothing to a comment
body. A diff that commits a credential is exactly the kind of defect a seat
should report, and reporting it means quoting it, so the gate strips the key
from every string bound for a comment before rendering it. Invisible characters
come out first, because a key split by a zero-width mark would survive an
exact-string redaction and a later render would reassemble it.

## Cost

The comment reports the tokens a run used and, when it can, what they cost.

**Token prices are workflow inputs, not a table in this repository.** A rate
committed here would go stale the next time a vendor changed its pricing, and
nothing would fail. The comment would keep reporting a number whose method had
quietly become wrong. Supplying the rate at the call site keeps every figure
traceable to a rate the caller stated, and the comment names that rate beside
the figure.

With no rates configured, the comment says so and reports token counts alone. It
never guesses a price.

### The ceiling

`cost-ceiling-usd` is checked before the seat is called, and against the worst
the run is allowed to do rather than the likely case: the whole output
allowance is billed, not an expected reply length. A ceiling checked after the
call is not a ceiling, and neither is one checked against an optimistic guess.

**The bound is conservative, not proven.** Counting real tokens needs a
per-model tokenizer, which this action does not carry, so the pre-flight prices
characters instead. The diff budget packs at four characters per token, a
typical ratio. The ceiling uses two, because dense or non-Latin text tokenizes
closer to that and a typical ratio would price such a diff at half its real
cost and wave it through. Both numbers are approximations. The ceiling is
enforced against the pessimistic one, and this paragraph is the method behind
the figure rather than a claim of certainty.

The estimate also counts the tool schema, which travels with every request.

The dollar ceiling has no effect without configured rates, because there is no
spend figure to compare against it. A run that has a key and no rates says so
twice: in the comment, and as a warning in the run log, since whoever is paying
reads one and not always the other. The token ceiling always applies.

## Variance between runs

The action sends no sampling controls. Variance between identical runs is
noise in a measurement, so suppressing it would be worth doing, and there is no
control available to do it with: `temperature` is deprecated on current models
and sending it fails the request with a 400. That is a live result, not a
reading of the documentation.

The marker token in the data region is also minted fresh for every run, by
design, because a predictable delimiter would be a forgeable one.

Two runs over the same commit can therefore report different findings.
Everything around the seat is deterministic: the diff plan, the validation, the
ordering, and the rendering are pure functions of their inputs. Comparability
of scores comes from pinning the prompt version and fixing the corpus, not from
expecting one review to reproduce another exactly.

## What none of this measures

Validation is structural. It proves a published finding points at a line the
diff changed, and that nothing reached the comment unvalidated. It says nothing
about whether the finding is correct.

Precision, recall, and false-block rate are measurements over a labeled corpus,
and that corpus is not built yet. Until it is, this repository publishes
mechanisms and no scores.
