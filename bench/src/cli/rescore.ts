/**
 * `npm run bench:rescore` — re-scores the recorded run under the current rules.
 *
 * Needs no key and spends nothing. It reads the committed audit trail, applies
 * today's scoring code to it, and rewrites REPORT.md and scorecard.json.
 *
 * This exists so a change to the scoring rules can be reviewed on its own. A
 * fresh benchmark run would move every figure, because every case is a new
 * sample against a model with no sampling controls, and the one change under
 * review would be indistinguishable from noise. Re-scoring the same recorded
 * output isolates it: whatever the diff shows is what the rule change did, and
 * everything it leaves untouched is proof of what the change did not do.
 *
 * It refuses to run when the corpus labels have moved since the recording. See
 * rescore.ts for why that guard is the whole point.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AuditLog } from '../audit.js';
import { readCorpus } from '../corpus.js';
import { renderReport, type ReportMeta } from '../report.js';
import { rebuildRuns } from '../rescore.js';
import { scoreCorpus } from '../score.js';

function main(): void {
  const root = process.cwd();
  const outDir = join(root, 'bench', 'results');
  const runsPath = join(outDir, 'runs.json');

  if (!existsSync(runsPath)) {
    console.error(
      '::error::No audit trail at bench/results/runs.json, so there is no run to re-score. ' +
        'Run `npm run bench` with a key to produce one.',
    );
    process.exit(1);
  }

  const recorded = JSON.parse(readFileSync(runsPath, 'utf8')) as AuditLog & { meta: ReportMeta };
  const corpus = readCorpus();

  if (corpus.problems.length > 0) {
    console.error('::error::The corpus does not validate, so nothing can be scored against it.');
    for (const problem of corpus.problems) {
      console.error(`  ${problem}`);
    }
    process.exit(1);
  }

  const { runs, problems, warnings } = rebuildRuns(recorded, corpus.cases);

  if (runs === undefined) {
    console.error(
      '::error::The corpus has changed since this run was recorded, so re-scoring it would ' +
        'measure old output against new labels.',
    );
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exit(1);
  }

  // A partial guard is not a passed guard. When the recording predates case
  // fingerprints, what could not be checked is printed and the operator has to
  // say so on the command line. Proceeding quietly here would make an
  // unverified re-score look identical to a verified one.
  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.error(`::warning::${warning}`);
    }
    if (!process.argv.includes('--unverified')) {
      console.error(
        '::error::Refusing to re-score without a full guard. Re-run with --unverified to ' +
          'accept the gaps above, and say in the change why they are acceptable.',
      );
      process.exit(1);
    }
    console.error('Proceeding with --unverified.');
  }

  const card = scoreCorpus(runs);

  // The recorded metadata travels with the numbers. The model, the prompt
  // version, and the date all belong to the original run, and claiming today's
  // date for a re-score would date the measurement to when it was recomputed.
  const meta: ReportMeta = recorded.meta;

  writeFileSync(join(outDir, 'REPORT.md'), renderReport(card, meta));
  writeFileSync(join(outDir, 'scorecard.json'), `${JSON.stringify({ meta, card }, null, 2)}\n`);

  console.log(
    `Re-scored ${String(runs.length)} recorded case(s) from ${meta.generatedAt} under the ` +
      'current rules.',
  );
  console.log(`Wrote ${join(outDir, 'REPORT.md')} and scorecard.json.`);
  console.log('Run `npm run scorecard` to fold the result into the README.');
}

main();
