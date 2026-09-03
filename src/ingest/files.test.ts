import { expect, test } from 'vitest';

import { toDiffFiles } from './files.js';

test('maps the API file list into diff files', () => {
  const files = toDiffFiles([
    {
      filename: 'src/app.ts',
      status: 'modified',
      additions: 3,
      deletions: 1,
      patch: '@@ -1 +1 @@\n-a\n+b',
    },
  ]);

  expect(files).toEqual([
    {
      path: 'src/app.ts',
      status: 'modified',
      additions: 3,
      deletions: 1,
      patch: '@@ -1 +1 @@\n-a\n+b',
    },
  ]);
});

test('omits the patch entirely when the API supplies none', () => {
  const [file] = toDiffFiles([
    { filename: 'logo.png', status: 'added', additions: 0, deletions: 0 },
  ]);

  expect(file).toBeDefined();
  expect('patch' in file!).toBe(false);
});

test('maps the unchanged status, which the API returns for files with no delta', () => {
  const [file] = toDiffFiles([
    { filename: 'src/app.ts', status: 'unchanged', additions: 0, deletions: 0, patch: '' },
  ]);

  expect(file?.status).toBe('unchanged');
});
