import { expect, test } from 'vitest';

import { charBudgetForTokens, planDiffBudget, type DiffFile } from './budget.js';

function textFile(path: string, patchChars: number): DiffFile {
  return {
    path,
    status: 'modified',
    additions: 1,
    deletions: 0,
    patch: 'x'.repeat(patchChars),
  };
}

test('packs the smallest patches first so one oversized file cannot starve the rest', () => {
  const plan = planDiffBudget(
    [textFile('huge.ts', 900), textFile('small-a.ts', 100), textFile('small-b.ts', 100)],
    { charBudget: 500 },
  );

  expect(plan.included.map((f) => f.path)).toEqual(['small-a.ts', 'small-b.ts']);
  expect(plan.dropped).toEqual([{ path: 'huge.ts', reason: 'over-budget', chars: 900 }]);
});

test('converts a token ceiling into a character budget, reserving prompt headroom', () => {
  // 120000 tokens, 70 percent of which is available to the diff, at 4 chars per token.
  expect(charBudgetForTokens(120_000)).toBe(336_000);
});

test('never returns a negative character budget for a tiny ceiling', () => {
  expect(charBudgetForTokens(1)).toBeGreaterThanOrEqual(0);
});

test('drops binary files, which carry no patch to review', () => {
  const plan = planDiffBudget(
    [
      { path: 'logo.png', status: 'added', additions: 0, deletions: 0 },
      textFile('src/app.ts', 50),
    ],
    { charBudget: 500 },
  );

  expect(plan.included.map((f) => f.path)).toEqual(['src/app.ts']);
  expect(plan.dropped).toEqual([{ path: 'logo.png', reason: 'binary', chars: 0 }]);
});

test('drops generated files before budgeting, so they never consume budget', () => {
  const plan = planDiffBudget(
    [textFile('package-lock.json', 10_000), textFile('src/app.ts', 100)],
    { charBudget: 500 },
  );

  expect(plan.included.map((f) => f.path)).toEqual(['src/app.ts']);
  expect(plan.charsUsed).toBe(100);
  expect(plan.dropped).toEqual([
    { path: 'package-lock.json', reason: 'generated', chars: 10_000 },
  ]);
});

test('keeps deletion-only patches, because removing a guard is a reviewable defect', () => {
  const plan = planDiffBudget(
    [
      {
        path: 'src/authz.ts',
        status: 'removed',
        additions: 0,
        deletions: 40,
        patch: '-  if (!user.canEdit) throw new ForbiddenError();',
      },
    ],
    { charBudget: 500 },
  );

  expect(plan.included.map((f) => f.path)).toEqual(['src/authz.ts']);
  expect(plan.dropped).toEqual([]);
});
