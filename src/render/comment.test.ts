import { expect, test } from 'vitest';

import { COMMENT_MARKER, findReviewComment } from './comment.js';

test('finds the run\'s own marked comment and ignores everything else', () => {
  const found = findReviewComment([
    { id: 1, body: 'looks good to me' },
    { id: 2, body: `${COMMENT_MARKER}\nprevious review` },
  ]);

  expect(found?.id).toBe(2);
});

test('returns null when no marked comment exists yet', () => {
  expect(findReviewComment([{ id: 1, body: 'looks good to me' }])).toBeNull();
});

test('picks the lowest id when duplicates exist, so re-runs never alternate', () => {
  const found = findReviewComment([
    { id: 9, body: `${COMMENT_MARKER}\nsecond` },
    { id: 4, body: `${COMMENT_MARKER}\nfirst` },
  ]);

  expect(found?.id).toBe(4);
});

test('tolerates a comment with no body', () => {
  expect(findReviewComment([{ id: 1 }])).toBeNull();
});
