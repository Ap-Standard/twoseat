/**
 * `npm run scorecard`: folds the last benchmark run into the README and
 * renders the README hero from the same file.
 *
 * Reads the scorecard the run committed rather than calling a model, so it
 * needs no key, costs nothing, and is deterministic. That is what lets CI
 * regenerate and compare: a README whose numbers drifted from the report they
 * claim to summarize is a published figure with no method behind it, and the
 * same holds for a picture of those numbers.
 *
 * With no run on disk it says so and exits cleanly, because a repository that
 * has not measured itself yet is a valid state and not a build failure.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { renderReport, renderScorecardBlock, type ReportMeta } from '../report.js';
import { spliceScorecard } from '../readme.js';
import type { Scorecard } from '../score.js';
import { renderScorecardSvg } from '../svg.js';

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

  // The README block, the report, and the hero are all derived from this one
  // file, so all three are regenerated from it. That is also what makes a
  // prose or layout fix to any renderer free: the numbers are already on
  // disk, and correcting how they read must never require paying for another
  // run.
  const reportPath = join(root, 'bench', 'results', 'REPORT.md');
  const report = renderReport(persisted.card, persisted.meta);
  const reportOnDisk = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '';

  const svgPath = join(root, 'docs', 'assets', 'scorecard.svg');
  const svg = renderScorecardSvg(persisted.card, persisted.meta);
  const svgOnDisk = existsSync(svgPath) ? readFileSync(svgPath, 'utf8') : '';

  const readmeStale = result.readme !== readme;
  const reportStale = report !== reportOnDisk;
  const svgStale = svg !== svgOnDisk;

  if (!readmeStale && !reportStale && !svgStale) {
    console.log('README scorecard, report, and hero already match the last run.');
    return;
  }

  if (check) {
    const stale = [
      readmeStale ? 'README scorecard' : null,
      reportStale ? 'REPORT.md' : null,
      svgStale ? 'docs/assets/scorecard.svg' : null,
    ]
      .filter((name) => name !== null)
      .join(' and ');
    console.error(
      `::error::${stale} drifted from bench/results/scorecard.json. ` +
        'Run `npm run scorecard` and commit the result.',
    );
    process.exit(1);
  }

  if (readmeStale) writeFileSync(readmePath, result.readme);
  if (reportStale) writeFileSync(reportPath, report);
  if (svgStale) {
    mkdirSync(dirname(svgPath), { recursive: true });
    writeFileSync(svgPath, svg);
  }
  console.log('Regenerated from bench/results/scorecard.json.');
}

main();
