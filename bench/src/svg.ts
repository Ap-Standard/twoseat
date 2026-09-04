/**
 * The README hero: one SVG rendered from the committed scorecard.
 *
 * The hero is the proof or there is no hero. Every figure on the card comes
 * from bench/results/scorecard.json through this function, so the picture
 * cannot say something the report does not. `npm run scorecard` regenerates
 * it and `scorecard:check` fails CI when the committed file has drifted.
 *
 * Three rules, shared with report.ts:
 *
 * 1. An undefined rate prints as "not measured", never as zero.
 * 2. The model, the prompt version, and the as-of date travel with the numbers.
 * 3. The output is a pure function of its input, so a rerun that changes
 *    nothing produces no diff.
 *
 * The file references nothing outside itself: no font import, no image, no
 * script, no stylesheet. GitHub serves README images through a proxy that
 * blocks external fetches, and a hero that rendered differently from the file
 * on disk would be a figure with no method.
 */
import type { ReportMeta } from './report.js';
import type { Scorecard } from './score.js';

const WIDTH = 640;
const HEIGHT = 220;

/** Opaque neutrals, so the card reads the same on light and dark GitHub. */
const CARD_FILL = '#f0f2f4';
const CARD_STROKE = '#8b949e';
const RULE = '#d0d7de';
const INK = '#1f2328';
const INK_SOFT = '#57606a';

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const NOT_MEASURED = 'not measured';

/** Every string that reaches the markup passes through here, including labels. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function percent(value: number | null): string {
  return value === null ? NOT_MEASURED : `${(value * 100).toFixed(1)}%`;
}

function usd(value: number | null): string {
  return value === null ? NOT_MEASURED : `$${value.toFixed(4)}`;
}

/** The date part of an ISO timestamp, or the raw text when it is not one. */
function asOf(generatedAt: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(generatedAt) ? generatedAt.slice(0, 10) : generatedAt;
}

interface Headline {
  label: string;
  value: string;
}

function headlines(card: Scorecard): Headline[] {
  return [
    { label: 'Precision', value: percent(card.overall.precision) },
    { label: 'Recall', value: percent(card.overall.recall) },
    { label: 'F1', value: percent(card.overall.f1) },
    { label: 'Median cost per review', value: usd(card.cost.medianUsd) },
  ];
}

function headlineColumn(entry: Headline, index: number): string {
  const x = String(24 + index * 148);
  // "not measured" is a sentence, not a figure. It is set smaller so it never
  // reads as one at a glance.
  const size = entry.value === NOT_MEASURED ? '15' : '32';
  return [
    `<text x="${x}" y="78" font-family="${SANS}" font-size="12" fill="${INK_SOFT}">${escapeXml(entry.label)}</text>`,
    `<text x="${x}" y="114" font-family="${MONO}" font-size="${size}" font-weight="700" fill="${INK}">${escapeXml(entry.value)}</text>`,
  ].join('\n');
}

function footer(card: Scorecard, meta: ReportMeta): string[] {
  const total = String(card.cases.total);
  const scored = String(card.cases.scored);
  const sampling =
    meta.runsPerCase > 1
      ? `${String(meta.runsPerCase)} runs per case.`
      : 'Single run per case, no sampling controls.';
  const first =
    card.cases.scored === 0
      ? `No case reached a seat, so nothing was scored: ${scored} of ${total} cases.`
      : `${scored} of ${total} synthetic cases scored. ${sampling}`;

  return [
    first,
    'Synthetic diffs are cleaner than real ones, so every figure is an upper bound.',
    `Method: bench/README.md. Report: bench/results/REPORT.md. As of ${asOf(meta.generatedAt)}.`,
  ];
}

export function renderScorecardSvg(card: Scorecard, meta: ReportMeta): string {
  const columns = headlines(card).map(headlineColumn);
  const footerLines = footer(card, meta).map(
    (line, index) =>
      `<text x="24" y="${String(164 + index * 20)}" font-family="${SANS}" font-size="12" fill="${INK_SOFT}">${escapeXml(line)}</text>`,
  );
  const provenance = `${meta.model}, prompt version ${meta.promptVersion}`;
  const description =
    `twoseat benchmark scorecard: ${headlines(card)
      .map((entry) => `${entry.label} ${entry.value}`)
      .join(', ')}. ` + footer(card, meta).join(' ');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(WIDTH)}" height="${String(HEIGHT)}" viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}" role="img" aria-labelledby="title desc">`,
    '<title id="title">twoseat scorecard</title>',
    `<desc id="desc">${escapeXml(description)}</desc>`,
    `<rect x="0.5" y="0.5" width="${String(WIDTH - 1)}" height="${String(HEIGHT - 1)}" rx="8" fill="${CARD_FILL}" stroke="${CARD_STROKE}"/>`,
    `<text x="24" y="36" font-family="${SANS}" font-size="16" font-weight="600" fill="${INK}">twoseat scorecard</text>`,
    `<text x="616" y="36" text-anchor="end" font-family="${MONO}" font-size="12" fill="${INK_SOFT}">${escapeXml(provenance)}</text>`,
    ...columns,
    `<line x1="24" y1="140" x2="616" y2="140" stroke="${RULE}"/>`,
    ...footerLines,
    '</svg>',
    '',
  ].join('\n');
}
