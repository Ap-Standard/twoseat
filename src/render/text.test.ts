import { expect, test } from 'vitest';

import { COMMENT_MARKER } from './comment.js';
import { neutralizeForComment, neutralizePathForComment } from './text.js';

test('strips a backtick from a path, which would otherwise close the code span', () => {
  expect(neutralizePathForComment('src/we`ird.ts')).toBe('src/weird.ts');
});

test('leaves an ordinary path untouched, so a reviewer can click it', () => {
  expect(neutralizePathForComment('src/deep/nested-file.test.ts')).toBe(
    'src/deep/nested-file.test.ts',
  );
});

test('defangs a mention, so a finding cannot notify someone who is not on the review', () => {
  const out = neutralizeForComment('ask @octocat about this');

  expect(out).not.toContain('@octocat');
  expect(out).toContain('&#64;octocat');
});

test('leaves an at sign that is not a mention alone', () => {
  expect(neutralizeForComment('rate is 5 @ a time')).toContain('@ a time');
});

test('defangs an issue reference, so a finding cannot cross-link another repository', () => {
  expect(neutralizeForComment('see #123')).toContain('&#35;123');
});

test('escapes markup, so a finding cannot render HTML in the comment', () => {
  // An image tag would fetch an external URL the moment a reviewer opened the
  // pull request, which turns a comment into a read receipt.
  const out = neutralizeForComment('<img src="https://example.invalid/beacon.png">');

  expect(out).not.toContain('<img');
  expect(out).toContain('&lt;img');
});

test('escapes an ampersand before anything else, so an entity cannot be smuggled in', () => {
  expect(neutralizeForComment('a &lt; b')).toContain('&amp;lt; b');
});

test('collapses newlines, so a finding cannot add its own structure to the comment', () => {
  const out = neutralizeForComment('first\n\n### injected heading\n| a | b |');

  expect(out).not.toContain('\n');
  expect(out).toBe('first ### injected heading | a | b |');
});

test('cannot reproduce the marker the action uses to find its own comment', () => {
  expect(neutralizeForComment(`${COMMENT_MARKER} approved`)).not.toContain(COMMENT_MARKER);
});

test('shortens a run of backticks that would open a code fence', () => {
  const out = neutralizeForComment('```js malicious ```');

  expect(out).not.toContain('```');
});

test('keeps an inline code span, which reviewers rely on for identifiers', () => {
  expect(neutralizeForComment('call `flush()` first')).toBe('call `flush()` first');
});

test('strips control characters that would corrupt the rendered comment', () => {
  expect(neutralizeForComment('ok \u0007 then')).toBe('ok then');
});

test('strips a zero-width character used to hide a word break', () => {
  expect(neutralizeForComment('appro\u200bved')).toBe('approved');
});
