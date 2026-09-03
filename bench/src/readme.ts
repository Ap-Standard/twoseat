/**
 * Splicing the scorecard into the README.
 *
 * The README is hand-written prose with one generated block in it, so the
 * splice replaces exactly what sits between two markers and refuses anything
 * ambiguous. Appending to a README that lost its markers would quietly produce
 * two scorecards, one of them stale, and the stale one would still read as a
 * published claim.
 *
 * The operation is idempotent, which is what lets CI check for drift by
 * regenerating and comparing.
 */
import { SCORECARD_END, SCORECARD_START } from './report.js';

export type SpliceResult = { ok: true; readme: string } | { ok: false; problem: string };

export function spliceScorecard(readme: string, block: string): SpliceResult {
  const start = readme.indexOf(SCORECARD_START);
  const end = readme.indexOf(SCORECARD_END);

  if (start === -1) {
    return {
      ok: false,
      problem: `README has no ${SCORECARD_START} marker, so there is nowhere to put the scorecard`,
    };
  }
  if (end === -1) {
    return { ok: false, problem: `README has no ${SCORECARD_END} marker` };
  }
  if (end < start) {
    return { ok: false, problem: 'README scorecard markers appear in the wrong order' };
  }

  const before = readme.slice(0, start);
  const after = readme.slice(end + SCORECARD_END.length);

  // The block carries its own markers and a trailing newline, so the tail is
  // reattached without one to keep the splice idempotent.
  return { ok: true, readme: `${before}${block.replace(/\n+$/, '')}${after}` };
}
