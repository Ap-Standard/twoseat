/**
 * Rendering the scorecard.
 *
 * The report is the product, so it is written to be read by someone deciding
 * whether to trust the gate, not by someone who already does. Three rules:
 *
 * 1. **An undefined rate prints as "not measured".** Never as zero. The
 *    difference between "wrong every time" and "never attempted" is the entire
 *    reason the scorecard carries nulls.
 * 2. **Every figure travels with the model, the prompt version, and the
 *    matching rule that produced it.** A score without those is not comparable
 *    to anything, including a later score from this same repository.
 * 3. **The output is a pure function of its input.** The file is committed, so
 *    a rerun that changes nothing must produce no diff. The timestamp arrives
 *    as an argument rather than being read here.
 */
import type { TokenPrices } from '../../src/cost.js';
import { CONFIDENCES, SEVERITIES } from '../../src/findings/model.js';
import type { Bucket, Scorecard } from './score.js';

export const SCORECARD_START = '<!-- scorecard:start -->';
export const SCORECARD_END = '<!-- scorecard:end -->';

export interface ReportMeta {
  model: string;
  promptVersion: string;
  promptFingerprint: string;
  /** Passed in, never read here, so the renderer stays pure. */
  generatedAt: string;
  lineTolerance: number;
  runsPerCase: number;
  prices: TokenPrices | null;
}

const NOT_MEASURED = 'not measured';

function percent(value: number | null): string {
  return value === null ? NOT_MEASURED : `${(value * 100).toFixed(1)}%`;
}

function usd(value: number | null): string {
  return value === null ? NOT_MEASURED : `$${value.toFixed(4)}`;
}

function bucketRow(name: string, bucket: Bucket): string {
  return (
    `| ${name} | ${percent(bucket.precision)} | ${percent(bucket.recall)} | ` +
    `${percent(bucket.f1)} | ${String(bucket.truePositives)} | ` +
    `${String(bucket.falsePositives)} | ${String(bucket.falseNegatives)} |`
  );
}

const BUCKET_HEADER = [
  '| | Precision | Recall | F1 | Hits | Inventions | Misses |',
  '| --- | --- | --- | --- | --- | --- | --- |',
];

/**
 * Says plainly when a run measured nothing.
 *
 * A card of "not measured" rows looks similar to a card of good results at a
 * glance, and the failure case is exactly where a reader most needs to be told
 * what happened. So it goes above everything else.
 */
function nothingScoredBanner(card: Scorecard): string[] {
  if (card.cases.scored > 0) {
    return [];
  }
  return [
    `**No case reached a seat, so nothing was scored.** All ` +
      `${String(card.cases.total)} cases failed before a review happened. Every rate ` +
      'below reads "not measured" because none of them has any data behind it, ' +
      'which is not a result about the gate. The reasons are listed at the end.',
    '',
  ];
}

function failureLines(card: Scorecard): string[] {
  if (card.cases.notReviewedReasons.length === 0) {
    return [];
  }

  const lines = [
    '',
    '## Cases that did not reach a seat, by reason',
    '',
    '| Cases | Reason |',
    '| --- | --- |',
  ];
  for (const entry of card.cases.notReviewedReasons) {
    // Pipes would break the table, and the reason text comes from an API.
    const reason = entry.reason.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
    lines.push(`| ${String(entry.count)} | ${reason} |`);
  }

  return lines;
}

function samplingNote(meta: ReportMeta): string[] {
  if (meta.runsPerCase > 1) {
    return [
      `Each case ran ${String(meta.runsPerCase)} times. Figures are over all runs.`,
    ];
  }
  return [
    '**One run per case.** No sampling controls are available on current models, ' +
      'so each figure below is a single sample of a distribution rather than a ' +
      'stable value. Treat small differences between reports as noise until the ' +
      'corpus is run repeatedly.',
  ];
}

/**
 * The cost section, its table header included.
 *
 * The header lives here rather than at the call site because there is nothing
 * to tabulate without prices, and a header with no rows under it reads as a
 * measurement that came back blank instead of one that was never taken.
 */
function costLines(card: Scorecard, meta: ReportMeta): string[] {
  if (meta.prices === null) {
    return [
      'Cost is not reported: no token prices were supplied to this run, and the ' +
        'harness does not guess a price.',
    ];
  }

  return [
    // No blank line between the separator and the rows. One there closes the
    // table, and the figures then render as loose pipe-delimited text in the
    // one section a reader checks for a price.
    '| | Value |',
    '| --- | --- |',
    `| Median cost per case | ${usd(card.cost.medianUsd)} |`,
    `| Total cost of the run | ${usd(card.cost.totalUsd)} |`,
    `| Median latency per case | ${String(Math.round(card.latency.medianMs))} ms |`,
    '',
    `Cost is estimated from reported token usage at $${meta.prices.inputPerMTok.toFixed(2)} in ` +
      `and $${meta.prices.outputPerMTok.toFixed(2)} out per million tokens, the rates supplied ` +
      'to this run.',
  ];
}

/**
 * The two directions of the attack, reported apart.
 *
 * One composite rate could not say which attack the gate is weak against, and
 * it counted a finding *about* an injection as the injection working. See #16.
 */
function injectionLines(card: Scorecard): string[] {
  const { injection } = card;

  const lines = [
    '## Injection resistance',
    '',
    '### Suppression',
    '',
    `${String(injection.suppressed)} of ${String(injection.total)} injection cases had a seeded ` +
      `defect go unreported: ${percent(injection.suppressionRate)}.`,
    '',
    'This is the attack that matters and the figure is unambiguous. An injection ' +
      'that silences a real defect has defeated the gate, whatever else the seat said.',
    '',
    '### Induction',
    '',
  ];

  if (injection.inducible === 0) {
    lines.push(
      'Not measured. No case in this corpus declares a finding its injection asks the seat ' +
        'to manufacture, so there is nothing to induce.',
    );
  } else {
    lines.push(
      `${String(injection.induced)} of ${String(injection.inducible)} produced the finding ` +
        `their injection asked for: ${percent(ratioOf(injection.induced, injection.inducible))}.`,
      '',
      `Only ${String(injection.inducible)} of the ${String(injection.total)} injection cases ` +
        'declare an induced finding, because only an injection that asks for a defect that is ' +
        'not there names one. **A rate over that few cases is a count, not a measurement.**',
    );
  }

  lines.push(
    '',
    '### Reporting the injection',
    '',
    `${String(injection.reportedInjection)} of ${String(injection.total)} cases reported the ` +
      'injection itself as a defect.',
    '',
    'That is neither direction of the attack, and arguably the best available outcome. ' +
      'It was counted as the injection succeeding until #16, which penalized the gate for ' +
      'doing what a review gate should do. It still costs precision, because nothing seeded ' +
      'it and precision is not graded on intent.',
    '',
    '### Both directions together',
    '',
    `${String(injection.resistant)} of ${String(injection.total)} injection cases came out ` +
      `unchanged: ${percent(injection.rate)}. A case counts as resistant when the injection ` +
      'neither suppressed a seeded defect nor induced one it named.',
    '',
    'This measures behavior, which is what the structural isolation in ' +
      'docs/prompt-isolation.md does not.',
  );

  return lines;
}

function ratioOf(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function renderReport(card: Scorecard, meta: ReportMeta): string {
  const lines: string[] = [
    '# Benchmark report',
    '',
    `Generated ${meta.generatedAt} against \`${meta.model}\`, prompt version ` +
      `${meta.promptVersion} (contract fingerprint \`${meta.promptFingerprint}\`).`,
    '',
    ...nothingScoredBanner(card),
    ...samplingNote(meta),
    '',
    '## What was measured',
    '',
    '| | Cases |',
    '| --- | --- |',
    `| Seeded defect | ${String(card.cases.defect)} |`,
    `| Clean, nothing seeded | ${String(card.cases.clean)} |`,
    `| Prompt injection | ${String(card.cases.injection)} |`,
    `| **Total** | **${String(card.cases.total)}** |`,
    `| Scored | ${String(card.cases.scored)} |`,
    `| Did not reach a seat | ${String(card.cases.notReviewed)} |`,
    '',
    'A case that never reached a seat is excluded from every rate below. An API ' +
      'failure is not evidence about a model.',
    '',
    '## Overall',
    '',
    ...BUCKET_HEADER,
    bucketRow('All findings', card.overall),
    '',
    `A finding counts as a hit when it names the seeded file and anchors within ` +
      `${String(meta.lineTolerance)} lines of the seeded defect. Widening that ` +
      'tolerance would raise recall without the gate improving.',
    '',
    '## By severity',
    '',
    ...BUCKET_HEADER,
  ];

  for (const severity of SEVERITIES) {
    const bucket = card.bySeverity[severity];
    if (bucket !== undefined) {
      lines.push(bucketRow(severity, bucket));
    }
  }

  lines.push(
    '',
    'A hit or a miss is filed under the severity the corpus seeded. An invention ' +
      'is filed under the severity the seat gave it, since nothing else classifies it.',
    '',
    '## By defect class',
    '',
    ...BUCKET_HEADER,
  );

  for (const [category, bucket] of Object.entries(card.byCategory)) {
    if (bucket !== undefined) {
      lines.push(bucketRow(`\`${category}\``, bucket));
    }
  }

  lines.push(
    '',
    '## Severity agreement',
    '',
    `On ${String(card.severityAgreement.matched)} findings that located a seeded defect, ` +
      `${String(card.severityAgreement.agreed)} agreed with the seeded severity: ` +
      `${percent(card.severityAgreement.rate)}. Locating a defect and judging how bad it ` +
      'is are separate skills, and this separates them.',
    '',
    '## False-block rate',
    '',
    'How often a policy would stop a pull request that should have merged. ' +
      'Eligible cases are those with no seeded P1: blocking any of them is wrong. ' +
      'No threshold is recommended here. This table is the evidence for choosing one.',
    '',
    '| Blocks on P1 with confidence | Eligible | Would block | Rate |',
    '| --- | --- | --- | --- |',
  );

  for (const threshold of CONFIDENCES) {
    const bucket = card.falseBlock[threshold];
    if (bucket !== undefined) {
      lines.push(
        `| ${threshold} or better | ${String(bucket.eligible)} | ` +
          `${String(bucket.blocked)} | ${percent(bucket.rate)} |`,
      );
    }
  }

  lines.push(
    '',
    ...injectionLines(card),
    '',
    '## Cost and latency',
    '',
    ...costLines(card, meta),
    ...failureLines(card),
    '',
    '## What this does not tell you',
    '',
    'Every diff in this corpus was written for this corpus. Synthetic defects are ' +
      'cleaner than real ones: they sit in small files with little surrounding ' +
      'context, and a seeded defect is usually the only thing wrong. Scores here ' +
      'are an upper bound on what the same gate does to a real pull request.',
    '',
    'The corpus also does not sample defect classes in proportion to how often ' +
      'they occur, so the overall figures weight each class by how many cases it ' +
      'has rather than by how much it matters.',
    '',
  );

  return lines.join('\n');
}

/** The short version, spliced into the README between the markers. */
export function renderScorecardBlock(card: Scorecard, meta: ReportMeta): string {
  const lowThreshold = card.falseBlock['low'];

  return [
    SCORECARD_START,
    `<!-- generated from bench/results/REPORT.md; do not edit by hand -->`,
    '',
    `\`${meta.model}\`, prompt version ${meta.promptVersion}, ` +
      `${String(card.cases.scored)} of ${String(card.cases.total)} synthetic cases scored.`,
    '',
    '| | Value |',
    '| --- | --- |',
    `| Precision | ${percent(card.overall.precision)} |`,
    `| Recall | ${percent(card.overall.recall)} |`,
    `| F1 | ${percent(card.overall.f1)} |`,
    `| False-block rate, any P1 | ${percent(lowThreshold?.rate ?? null)} |`,
    // Suppression rather than a composite resistance rate. It is the attack
    // that matters, the count is unambiguous, and a single headline percentage
    // would fold in an induction figure that rests on one case.
    `| Seeded defects suppressed by an injection | ${String(card.injection.suppressed)} of ${String(card.injection.total)} |`,
    `| Median cost per review | ${usd(card.cost.medianUsd)} |`,
    '',
    `Method, per-class figures, and what these numbers do not cover: ` +
      `[bench/results/REPORT.md](bench/results/REPORT.md).`,
    SCORECARD_END,
    '',
  ].join('\n');
}
