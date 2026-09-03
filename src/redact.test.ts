import { expect, test } from 'vitest';

import { redactSecret, stripInvisible } from './redact.js';

const KEY = 'sk-test-0123456789-not-a-real-credential';

test('replaces every occurrence of a secret', () => {
  expect(redactSecret(`a ${KEY} b ${KEY}`, KEY)).toBe('a (redacted) b (redacted)');
});

test('leaves text alone when there is no secret to redact', () => {
  expect(redactSecret('nothing to hide', null)).toBe('nothing to hide');
  expect(redactSecret('nothing to hide', '')).toBe('nothing to hide');
});

test('strips a zero-width character used to split a secret', () => {
  // The reason this matters: a secret broken by an invisible character does not
  // match an exact-string redaction, and a later render that strips invisible
  // characters would reassemble it.
  expect(stripInvisible('sk\u200b-test')).toBe('sk-test');
});

test('redacts a secret that arrives split by an invisible character', () => {
  const split = 'sk-test-0123456789\u200b-not-a-real-credential';

  expect(redactSecret(stripInvisible(split), KEY)).toBe('(redacted)');
});

test('strips bidirectional overrides that would reorder displayed text', () => {
  expect(stripInvisible('abc\u202edef')).toBe('abcdef');
});
