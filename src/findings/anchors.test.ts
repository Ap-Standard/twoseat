import { expect, test } from 'vitest';

import { isAnchoredInDiff, parseHunkRanges } from './anchors.js';

test('reads the new-file line range out of a hunk header', () => {
  expect(parseHunkRanges('@@ -3,4 +10,5 @@ function f() {\n context\n')).toEqual([
    { start: 10, end: 14 },
  ]);
});

test('treats an omitted count as one line, which is how git writes it', () => {
  expect(parseHunkRanges('@@ -1 +7 @@\n+x\n')).toEqual([{ start: 7, end: 7 }]);
});

test('reads every hunk in a multi-hunk patch', () => {
  const patch = ['@@ -1,2 +1,2 @@', ' a', '-b', '+c', '@@ -40,1 +40,3 @@', ' d', '+e', '+f'].join(
    '\n',
  );

  expect(parseHunkRanges(patch)).toEqual([
    { start: 1, end: 2 },
    { start: 40, end: 42 },
  ]);
});

test('anchors a deletion-only hunk at the line the removal follows', () => {
  // A pure deletion adds no line to the new file. The line above it is the
  // closest thing a reviewer can point at, so that is what the anchor allows.
  expect(parseHunkRanges('@@ -20,3 +19,0 @@\n-gone\n')).toEqual([{ start: 19, end: 19 }]);
});

test('drops a deletion-only hunk at the top of a file, which has no line above it', () => {
  expect(parseHunkRanges('@@ -1,3 +0,0 @@\n-gone\n')).toEqual([]);
});

test('ignores a hunk header forged inside patch content', () => {
  // Content lines always carry a +, -, or space prefix, so a real header is the
  // only thing that can start a line with @@. A diff that adds text shaped like
  // a header must not widen the range a finding may anchor to.
  const patch = ['@@ -1,1 +1,1 @@', '+@@ -1,1 +9000,50 @@', ' @@ -1,1 +8000,50 @@'].join('\n');

  expect(parseHunkRanges(patch)).toEqual([{ start: 1, end: 1 }]);
});

test('yields no ranges for a patch it cannot parse, so nothing anchors to it', () => {
  expect(parseHunkRanges('this is not a patch')).toEqual([]);
});

const files = [
  { path: 'src/app.ts', patch: '@@ -1,2 +10,3 @@\n a\n+b\n+c\n' },
  { path: 'src/other.ts', patch: '@@ -1,1 +1,1 @@\n+x\n' },
];

test('accepts a line inside a hunk of the named file', () => {
  expect(isAnchoredInDiff(files, 'src/app.ts', 11)).toBe(true);
});

test('rejects a line outside every hunk of the named file', () => {
  expect(isAnchoredInDiff(files, 'src/app.ts', 13)).toBe(false);
});

test('rejects a file the run never sent to a seat', () => {
  expect(isAnchoredInDiff(files, 'src/withheld.ts', 1)).toBe(false);
});

test('rejects a line number that is not a positive integer', () => {
  expect(isAnchoredInDiff(files, 'src/app.ts', 0)).toBe(false);
  expect(isAnchoredInDiff(files, 'src/app.ts', 10.5)).toBe(false);
});
