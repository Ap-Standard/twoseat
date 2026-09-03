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
- **Render markup.** The opening angle bracket is escaped, which disables every
  tag. Without that, a finding could carry an image whose URL is fetched the
  moment a reviewer opens the pull request, turning a comment into a read
  receipt.

Newlines collapse to spaces, so a finding cannot add its own headings or table
rows to a comment whose structure the action owns. Backtick runs shorten, so a
finding cannot open a code fence and swallow the rest. Control characters, zero
width marks, and bidirectional overrides are stripped. Titles cap at 160
characters and details at 800.

Escaping the opening angle bracket has a second effect worth naming: it makes
the action's own HTML comment marker unreproducible in seat text, so a finding
cannot plant a decoy marker for a later run to latch onto.

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

`cost-ceiling-usd` is checked before the seat is called, against the most the
run could possibly cost: the estimated input plus the entire output allowance.
A ceiling checked against a likely response length is not a ceiling, and a
ceiling checked after the call is not one either.

The dollar ceiling has no effect without configured rates, because there is no
spend figure to compare against it. The comment states that rather than leaving
a reader to assume a limit that is not running. The token ceiling always applies.

## What none of this measures

Validation is structural. It proves a published finding points at a line the
diff changed, and that nothing reached the comment unvalidated. It says nothing
about whether the finding is correct.

Precision, recall, and false-block rate are measurements over a labeled corpus,
and that corpus is not built yet. Until it is, this repository publishes
mechanisms and no scores.
