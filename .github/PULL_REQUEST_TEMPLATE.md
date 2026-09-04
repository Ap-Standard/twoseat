## Direction and acceptance (Arthur)

What was decided, why, and what had to be true for this to merge. Link the
issue or decision record that carries it.

Closes #

## Implementation (Claude)

What changed, in mechanism terms. Name every public contract change: inputs,
outputs, labels, the comment format, the prompt version.

## Verification

Paste the output of `npm run lint`, `npm run typecheck`, `npm test`,
`npm run check:text`, and `npm run scorecard:check`, or link the CI run. A
change to the action's runtime behavior needs evidence from a real run, not
only unit tests.

- [ ] No em dashes. Every number carries its method and its as-of date.
- [ ] Checked against
      [decision 0003](https://github.com/Ap-Standard/Ap-Standard/blob/main/docs/decisions/0003-sanitization-and-disclosure-policy.md):
      no names, no identifiers, no employer-attributable stories.
- [ ] Any benchmark case added here is synthetic, written for this corpus.
- [ ] The ai-review seat ran on this pull request; its findings are addressed
      or waived with the `gate-bypass` label and the reasoning in a comment.

## Mechanism in two sentences

Two sentences the maintainer could repeat cold. If it takes more, simplify the
change before asking for a merge.
