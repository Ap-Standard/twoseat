# Runbook

Operating twoseat on a repository. Every procedure here is a command or a
place to look; the reasoning lives in [degrade-policy.md](degrade-policy.md).

## Reading the comment

One comment per pull request, updated in place, marked by a hidden
`<!-- twoseat:review -->` line. Read it top down.

- **Headline.** `**No findings.**` means a seat reviewed the diff and reported
  nothing. `**The review did not run.**` means no seat produced a readable
  review, and the reason follows in the same line. `**2 P1, 1 P2.**` means
  findings follow. The first two never render as each other.
- **Blocking row.** `enabled`, or `disabled (reason)` with a count of findings
  that would otherwise have blocked.
- **Decision row.** `block`, `pass`, `blocking-disabled`, or `not-reviewed`.
  The same value ships as the `decision` output. The step exited 0 whatever
  the row says.
- **Not sent to a seat.** Files the budget withheld, each with its reason and
  size. A blind spot is listed, never hidden.
- **Discarded seat output.** Findings that failed validation, counted by
  reason. A parser gap shows up here as a number.

## Kill switch

Set the repository variable `TWOSEAT_BLOCKING_DISABLED` to `true`. The next
run reports `blocking-disabled` and prints "the kill switch is set" in the
Blocking row. No release and no code change.

```bash
gh variable set TWOSEAT_BLOCKING_DISABLED --body true -R <owner>/<repo>
gh variable delete TWOSEAT_BLOCKING_DISABLED -R <owner>/<repo>   # to re-enable
```

Any value the action cannot interpret also disables blocking. Malformed
configuration is a malfunction, and the gate never blocks on its own
malfunction. The switch is public in `action.yml` as the `blocking-disabled`
input. It does not stop spend; to stop spend, clear `api-key` in the workflow
and the gate reports `not-reviewed` at no cost.

## Cost ceiling

`cost-ceiling-usd` (default `0.50`) is checked before the seat is called,
against the most the call could cost: every input character priced at two per
token plus the whole output allowance. A run over the ceiling reports
`not-reviewed` with "Skipped to stay inside the cost ceiling" in the headline.
The ceiling only works when both `input-price-per-mtok` and
`output-price-per-mtok` are set; without them the run warns that it spends
uncapped and the 120,000-token ceiling is the only limit.

For scale: on this repository's own pull requests the estimated cost per review
ran from $0.0079 (PR #17, 2 files) to $0.2138 (PR #13, 79 files), read from the
twoseat comments on 2026-09-03 at $3.00 in and $15.00 out per million tokens.

## Key rotation

The key is a repository secret named `ANTHROPIC_API_KEY`. It reaches the
action as the `api-key` input, is masked in the run log by `core.setSecret`,
and is redacted from every comment-bound string. Rotate without ever writing
it to a file or a shell history line:

```bash
# 1. Create the new key in the Anthropic console.
# 2. Set the secret from the interactive prompt (paste, Enter, Ctrl-D). Nothing echoes.
gh secret set ANTHROPIC_API_KEY -R <owner>/<repo>
# 3. Re-run the latest review and confirm the headline is not "The review did not run".
gh run rerun "$(gh run list -R <owner>/<repo> --workflow ai-review.yml --limit 1 --json databaseId --jq '.[0].databaseId')" -R <owner>/<repo>
# 4. Revoke the old key in the console.
```

A pull request from a fork receives no secrets and reports `not-reviewed`;
that is the expected state, not a rotation failure.

## Cutting a release, with the Verified edit

1. Merge the release pull request. Only the maintainer merges.
2. Tag the merge commit and publish the changelog section as the notes:

   ```bash
   git checkout main && git pull --ff-only
   git tag -a vX.Y.Z -m "twoseat vX.Y.Z" "$(git rev-parse HEAD)"
   git push origin vX.Y.Z
   gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes-file <changelog section>
   ```

3. Wait for the first consumer run at `@vX.Y.Z` to complete with conclusion
   `success` after the release's `publishedAt`.
4. Append the verification to the release notes. A level-2 heading `## Verified`
   followed by one line holding the run URL, shape
   `https://github.com/Ap-Standard/<repo>/actions/runs/<id>`:

   ```bash
   gh release view vX.Y.Z --json body --jq .body > notes.md
   printf '\n## Verified\n\n%s\n' "https://github.com/Ap-Standard/<repo>/actions/runs/<id>" >> notes.md
   gh release edit vX.Y.Z --notes-file notes.md
   ```

A release without that section is unverified and the portfolio dashboard lists
it as such by name. Never pin consumers to a floating tag such as `@v0`; pin
the exact release.
