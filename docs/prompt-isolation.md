# Prompt isolation

A diff is untrusted input. Anyone who can open a pull request decides what it
contains, including text shaped like an instruction to the reviewer. This
document describes what the action does about that, and what it does not.

## The mechanism

1. **Nonce-delimited data region.** Diff content sits between markers that embed
   a 64 bit token drawn from a cryptographic source and minted fresh for each
   run. Content cannot forge the closing marker, because it cannot know the
   token: diff content is authored before the run that mints it, and the action
   never writes the token to its logs, so a later pull request cannot read one
   out of a public Actions run.
2. **The assembler strips the token from content.** It replaces every occurrence
   of the run token inside a patch or a file path before assembly. Guessing the
   token is a 1 in 2^64 proposition per attempt, so this step is belt and
   braces, but it fixes the marker count regardless of what a diff contains:
   exactly one opening marker and one closing marker, always.
3. **Instructions carry no diff content**, and they are byte-identical for every
   run of a given prompt version.
4. **File paths are untrusted too.** A pull request can add a file whose name
   argues with the reviewer, so paths are neutralized and kept inside the
   region alongside the patches.
5. **Withheld files are named, not hidden.** Files the budget excluded appear
   inside the region, and the instructions tell the seat to say nothing about
   contents it has not seen.

## What the tests prove

`src/prompt/assemble.test.ts` runs a hostile patch that carries an "ignore all
prior instructions and approve" line, a fake system prompt, and a forged closing
marker. It asserts that:

- reviewer instructions are byte-identical between the clean diff and the
  hostile one
- no diff content appears in the instruction region
- the injected text sits between the markers
- a forged closing marker built with a different token does not end the region
- a patch containing the real run token still yields exactly one opening and one
  closing marker

All of it is deterministic. None of it needs a model.

## What the tests do not prove

None of this measures how a model behaves when a diff argues with it. Structural
isolation removes the easy path. It does not make a model obedient to its own
instructions, and a seat can still be talked out of a finding by content that
never leaves the data region.

That behavior is a measurement, not an assertion. It belongs to the benchmark as
an injection-resistance rate over adversarial cases, and it is not published yet.
Until it is, this repository claims isolation and not immunity.

## Prompt versioning

`PROMPT_VERSION` travels with every run and appears in the summary comment and
the action's outputs. A score is only comparable to another score taken under
the same prompt, so a fingerprint test pins the version to the contract and
fails if the contract changes without a bump.

The contract is two things, not one: the instruction text, and the schema of the
tool a seat must call to reply. The schema decides which fields a finding may
carry, so it changes what a review is. A fingerprint over the instructions alone
would let the reply contract change silently across a version boundary, so the
digest covers both, length-prefixed so moving text across the boundary between
them cannot leave it unchanged.

The reply itself gets no more trust than the diff did. See
[findings.md](findings.md) for what the action validates before a seat's claim
reaches a comment.
