import { expect, test } from 'vitest';

import { SCORECARD_END, SCORECARD_START } from './report.js';
import { spliceScorecard } from './readme.js';

const readme = [
  '# twoseat',
  '',
  '## Scorecard',
  '',
  SCORECARD_START,
  'old numbers',
  SCORECARD_END,
  '',
  '## License',
].join('\n');

const block = [SCORECARD_START, 'new numbers', SCORECARD_END, ''].join('\n');

test('replaces what sits between the markers', () => {
  const result = spliceScorecard(readme, block);

  expect(result.ok).toBe(true);
  expect(result.ok && result.readme).toContain('new numbers');
  expect(result.ok && result.readme).not.toContain('old numbers');
});

test('leaves everything outside the markers alone', () => {
  const result = spliceScorecard(readme, block);

  expect(result.ok && result.readme).toContain('# twoseat');
  expect(result.ok && result.readme).toContain('## License');
});

test('is idempotent, so a rerun that changes nothing produces no diff', () => {
  // CI checks for drift by regenerating and comparing, which only works if the
  // splice is stable.
  const once = spliceScorecard(readme, block);
  const twice = spliceScorecard(once.ok ? once.readme : '', block);

  expect(twice.ok && twice.readme).toBe(once.ok ? once.readme : '');
});

test('refuses a README with no start marker rather than appending to it', () => {
  const result = spliceScorecard('# twoseat\n\n## License\n', block);

  expect(result.ok).toBe(false);
  expect(!result.ok && result.problem).toMatch(/marker/i);
});

test('refuses a README missing the end marker', () => {
  const result = spliceScorecard(`# t\n${SCORECARD_START}\nstuff\n`, block);

  expect(result.ok).toBe(false);
});

test('refuses markers that appear in the wrong order', () => {
  const result = spliceScorecard(`# t\n${SCORECARD_END}\nstuff\n${SCORECARD_START}\n`, block);

  expect(result.ok).toBe(false);
});
