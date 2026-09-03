/**
 * `npm run bench` — runs the corpus against a live seat.
 *
 * This command spends money and needs a key, so it is never wired into CI. The
 * deterministic half of the harness runs there instead: corpus validation,
 * matching, scoring, and rendering all have unit tests and no network.
 *
 * It writes two files. REPORT.md is for people. scorecard.json is for
 * `npm run scorecard`, which regenerates the README block from it without
 * needing a key or another paid run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TokenPrices } from '../../../src/cost.js';
import { promptContractFingerprint, PROMPT_VERSION } from '../../../src/prompt/assemble.js';
import { readCorpus } from '../corpus.js';
import { LINE_TOLERANCE } from '../match.js';
import { renderReport, renderScorecardBlock, type ReportMeta } from '../report.js';
import { liveSeat, runCorpus } from '../runner.js';
import { scoreCorpus } from '../score.js';

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') {
    console.error(
      `${name} is not set. This command calls a real model and needs a key.\n` +
        'The deterministic half of the harness runs without one: npm test.',
    );
    process.exit(1);
  }
  return value;
}

/** Both rates or neither, matching the action. Half a pair prices a run wrongly. */
function readPrices(): TokenPrices | null {
  const input = process.env['BENCH_INPUT_PRICE_PER_MTOK']?.trim() ?? '';
  const output = process.env['BENCH_OUTPUT_PRICE_PER_MTOK']?.trim() ?? '';

  if (input === '' && output === '') {
    return null;
  }
  if (input === '' || output === '') {
    console.error(
      'Set BENCH_INPUT_PRICE_PER_MTOK and BENCH_OUTPUT_PRICE_PER_MTOK together, or neither.',
    );
    process.exit(1);
  }

  const prices = { inputPerMTok: Number(input), outputPerMTok: Number(output) };
  if (!Number.isFinite(prices.inputPerMTok) || !Number.isFinite(prices.outputPerMTok)) {
    console.error('Token prices must be numbers.');
    process.exit(1);
  }
  return prices;
}

async function main(): Promise<void> {
  const casesDir = join(process.cwd(), 'bench', 'cases');
  const { cases, problems } = readCorpus(casesDir);

  if (problems.length > 0) {
    console.error('The corpus does not validate, so nothing was run:');
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exit(1);
  }

  const runsPerCase = Math.max(1, Number(flag('runs', '1')));
  const model = flag('model', process.env['BENCH_MODEL']?.trim() ?? 'claude-sonnet-5');
  const outDir = join(process.cwd(), flag('out', 'bench/results'));
  const prices = readPrices();
  const apiKey = requireEnv('ANTHROPIC_API_KEY');

  console.log(
    `Running ${String(cases.length)} cases x ${String(runsPerCase)} against ${model}, ` +
      `prompt version ${PROMPT_VERSION}.`,
  );
  if (prices === null) {
    console.log('No token prices set, so the report will omit cost.');
  }

  const runs = await runCorpus(
    cases,
    {
      seat: liveSeat,
      now: () => Date.now(),
      apiKey,
      model,
      tokenCeiling: Number(flag('token-ceiling', '120000')),
      prices,
    },
    runsPerCase,
    (done, total, benchCase) => {
      console.log(`  [${String(done)}/${String(total)}] ${benchCase.id}`);
    },
  );

  const card = scoreCorpus(runs);
  const meta: ReportMeta = {
    model,
    promptVersion: PROMPT_VERSION,
    promptFingerprint: promptContractFingerprint(),
    generatedAt: new Date().toISOString(),
    lineTolerance: LINE_TOLERANCE,
    runsPerCase,
    prices,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'REPORT.md'), renderReport(card, meta));
  writeFileSync(
    join(outDir, 'scorecard.json'),
    `${JSON.stringify({ meta, card }, null, 2)}\n`,
  );

  const notReviewed = card.cases.notReviewed;
  console.log(`\nWrote ${join(outDir, 'REPORT.md')}`);
  if (notReviewed > 0) {
    console.log(
      `${String(notReviewed)} case(s) never reached a seat and are excluded from every rate.`,
    );
  }
  console.log('Run `npm run scorecard` to fold the summary into the README.');
  console.log(renderScorecardBlock(card, meta));
}

await main();
