/**
 * `npm run scorecard` — folds the last benchmark run into the README.
 *
 * Reads the scorecard the run committed rather than calling a model, so it
 * needs no key, costs nothing, and is deterministic. That is what lets CI
 * regenerate and compare: a README whose numbers drifted from the report they
 * claim to summarize is a published figure with no method behind it.
 *
 * With no run on disk it says so and exits cleanly, because a repository that
 * has not measured itself yet is a valid state and not a build failure.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderScorecardBlock, type ReportMeta } from '../report.js';
import { spliceScorecard } from '../readme.js';
import type { Scorecard } from '../score.js';

interface Persisted {
  meta: ReportMeta;
  card: Scorecard;
}

function main(): void {
  const root = process.cwd();
  const scorecardPath = join(root, 'bench', 'results', 'scorecard.json');
  const readmePath = join(root, 'README.md');
  const check = process.argv.includes('--check');

  if (!existsSync(scorecardPath)) {
    console.log(
      'No benchmark run on disk, so the README scorecard is unchanged.\n' +
        'Run `npm run bench` with a key to produce one.',
    );
    return;
  }

  const persisted = JSON.parse(readFileSync(scorecardPath, 'utf8')) as Persisted;

  // A card of empty rows is worse than no card. It looks like a published
  // measurement and carries none, and a reader has no way to tell it apart
  // from a genuinely poor score.
  if (persisted.card.cases.scored === 0) {
    console.error(
      '::error::The last benchmark run scored no cases, so there is nothing to publish. ' +
        'Every row would read "not measured", which reads as a result and is not one. ' +
        'Fix why the run failed and try again.',
    );
    process.exit(1);
  }

  const block = renderScorecardBlock(persisted.card, persisted.meta);
  const readme = readFileSync(readmePath, 'utf8');
  const result = spliceScorecard(readme, block);

  if (!result.ok) {
    console.error(`::error::${result.problem}`);
    process.exit(1);
  }

  if (result.readme === readme) {
    console.log('README scorecard already matches the last run.');
    return;
  }

  if (check) {
    console.error(
      '::error::README scorecard is stale. Run `npm run scorecard` and commit the result.',
    );
    process.exit(1);
  }

  writeFileSync(readmePath, result.readme);
  console.log('README scorecard updated from bench/results/scorecard.json.');
}

main();
