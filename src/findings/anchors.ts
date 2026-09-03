/**
 * Anchor validation.
 *
 * A seat reports a file and a line. Neither is trustworthy: the response is
 * derived from a diff that whoever opened the pull request controls, and a model
 * can report a line it never saw. A finding on the wrong line reads as an
 * invented one, so the gate publishes a finding only when its anchor lands
 * inside a hunk of a file the run actually sent.
 *
 * The check fails closed. A patch this module cannot parse yields no ranges, so
 * every finding against it is rejected rather than published unverified.
 * Rejections are counted in the summary comment, so a parser gap shows up as a
 * visible number instead of a silent drop.
 */

export interface HunkRange {
  /** First line of the hunk in the new file, inclusive. */
  start: number;
  /** Last line of the hunk in the new file, inclusive. */
  end: number;
}

export interface AnchorableFile {
  path: string;
  patch: string;
}

/**
 * Matches a hunk header at the start of a line.
 *
 * Every content line in a unified diff carries a leading `+`, `-`, or space, so
 * a real header is the only thing that can begin a line with `@@`. That is what
 * keeps a diff from widening its own anchor range by adding text shaped like a
 * header.
 */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export function parseHunkRanges(patch: string): HunkRange[] {
  const ranges: HunkRange[] = [];

  for (const line of patch.split('\n')) {
    const match = HUNK_HEADER.exec(line);
    if (match === null) {
      continue;
    }

    const start = Number(match[1]);
    // An omitted count means one line. Git writes `@@ -1 +7 @@` that way.
    const count = match[2] === undefined ? 1 : Number(match[2]);

    if (count === 0) {
      // A pure deletion contributes no new line. `start` is the line the removal
      // follows, which is the closest thing a reviewer can point at. A deletion
      // at the top of a file has no line above it and gets no anchor.
      if (start >= 1) {
        ranges.push({ start, end: start });
      }
      continue;
    }

    ranges.push({ start, end: start + count - 1 });
  }

  return ranges;
}

export function isAnchoredInDiff(
  files: readonly AnchorableFile[],
  path: string,
  line: number,
): boolean {
  if (!Number.isInteger(line) || line < 1) {
    return false;
  }

  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    return false;
  }

  return parseHunkRanges(file.patch).some((range) => line >= range.start && line <= range.end);
}
