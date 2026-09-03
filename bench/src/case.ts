/**
 * The corpus format, and the checks that keep it trustworthy.
 *
 * The corpus is the measuring instrument, so an error in a case does not
 * produce a wrong score for one case. It discredits every number in the report.
 * A label pointing at a line its own diff never touched would mark a correct
 * seat wrong, and the gate would take the blame for a defect in the ruler.
 *
 * So every case validates against itself before it can be scored, using the
 * same anchor check the action applies to a real seat's reply. Validation is
 * deterministic and needs no API key, so it runs in CI on every pull request.
 *
 * Every diff in this corpus is written for this corpus. None is adapted from
 * any other codebase.
 */
import { isAnchoredInDiff, parseHunkRanges } from '../../src/findings/anchors.js';
import { SEVERITIES, type Severity } from '../../src/findings/model.js';

export type CaseKind = 'defect' | 'clean' | 'injection';

const KINDS: readonly CaseKind[] = ['defect', 'clean', 'injection'];

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ExpectedFinding {
  path: string;
  /** Line in the file as the diff leaves it. Must sit inside a hunk. */
  line: number;
  severity: Severity;
  category: string;
}

export interface CaseFile {
  path: string;
  patch: string;
}

export interface BenchCase {
  id: string;
  kind: CaseKind;
  /** Defect class, or `none` for a clean case. */
  category: string;
  description: string;
  /** Present only on injection cases: the instruction the diff carries. */
  injection?: string;
  files: CaseFile[];
  expected: ExpectedFinding[];
}

export interface ParsedCase {
  benchCase?: BenchCase;
  problems: string[];
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

interface FileProblem {
  file?: CaseFile;
  problems: string[];
}

/** A patch is authored as an array of lines, because escaped newlines in JSON hide mistakes. */
function parseFile(value: unknown, index: number): FileProblem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { problems: [`files[${String(index)}] is not an object`] };
  }

  const source = value as Record<string, unknown>;
  const path = readString(source, 'path');
  const lines = source['patch'];

  if (path === null) {
    return { problems: [`files[${String(index)}] has no path`] };
  }
  if (!Array.isArray(lines) || lines.some((line) => typeof line !== 'string')) {
    return { problems: [`${path}: patch must be an array of strings`] };
  }

  const patch = (lines as string[]).join('\n');

  if (parseHunkRanges(patch).length === 0) {
    return {
      problems: [`${path}: patch has no hunk header, so no finding could anchor to it`],
    };
  }

  return { file: { path, patch }, problems: [] };
}

function parseExpected(
  value: unknown,
  index: number,
  files: readonly CaseFile[],
): { expected?: ExpectedFinding; problems: string[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { problems: [`expected[${String(index)}] is not an object`] };
  }

  const source = value as Record<string, unknown>;
  const path = readString(source, 'path');
  const category = readString(source, 'category');
  const severity = readString(source, 'severity');
  const line = source['line'];

  const problems: string[] = [];
  if (path === null) problems.push(`expected[${String(index)}] has no path`);
  if (category === null) problems.push(`expected[${String(index)}] has no category`);
  if (severity === null || !SEVERITIES.includes(severity as Severity)) {
    problems.push(
      `expected[${String(index)}] severity ${JSON.stringify(severity)} is outside the published scale`,
    );
  }
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
    problems.push(`expected[${String(index)}] line must be a positive whole number`);
  }

  if (problems.length > 0 || path === null || category === null) {
    return { problems };
  }

  if (!files.some((file) => file.path === path)) {
    return { problems: [`expected finding names ${path}, which this case does not contain`] };
  }

  if (typeof line === 'number' && !isAnchoredInDiff(files, path, line)) {
    return {
      problems: [`expected finding on ${path} line ${String(line)} is outside its own diff`],
    };
  }

  return {
    expected: { path, line: line as number, severity: severity as Severity, category },
    problems: [],
  };
}

export function parseCase(value: unknown, source: string): ParsedCase {
  const stamp = (problems: string[]): string[] =>
    problems.map((problem) => `${source}: ${problem}`);

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { problems: stamp(['not an object']) };
  }

  const raw = value as Record<string, unknown>;
  const problems: string[] = [];

  const id = readString(raw, 'id');
  if (id === null) {
    problems.push('has no id');
  } else if (!ID_PATTERN.test(id)) {
    problems.push(`id ${JSON.stringify(id)} must be lowercase words joined by hyphens`);
  }

  const kind = readString(raw, 'kind');
  if (kind === null || !KINDS.includes(kind as CaseKind)) {
    problems.push(`kind ${JSON.stringify(kind)} must be one of ${KINDS.join(', ')}`);
  }

  const category = readString(raw, 'category');
  if (category === null) problems.push('has no category');

  const description = readString(raw, 'description');
  if (description === null) problems.push('has no description');

  const rawFiles = raw['files'];
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    problems.push('has no files');
    return { problems: stamp(problems) };
  }

  const files: CaseFile[] = [];
  rawFiles.forEach((entry, index) => {
    const parsed = parseFile(entry, index);
    problems.push(...parsed.problems);
    if (parsed.file !== undefined) {
      files.push(parsed.file);
    }
  });

  const rawExpected = raw['expected'];
  if (!Array.isArray(rawExpected)) {
    problems.push('expected must be an array, empty for a clean case');
    return { problems: stamp(problems) };
  }

  const expected: ExpectedFinding[] = [];
  rawExpected.forEach((entry, index) => {
    const parsed = parseExpected(entry, index, files);
    problems.push(...parsed.problems);
    if (parsed.expected !== undefined) {
      expected.push(parsed.expected);
    }
  });

  const injection = readString(raw, 'injection');

  if (kind === 'clean' && rawExpected.length > 0) {
    problems.push('a clean case must have no expected findings');
  }
  if (kind === 'defect' && rawExpected.length === 0) {
    problems.push('a defect case must label at least one expected finding');
  }
  if (kind === 'injection') {
    if (injection === null) {
      problems.push('an injection case must declare the injection text it carries');
    } else if (!files.some((file) => file.patch.includes(injection))) {
      problems.push(
        `the declared injection does not appear verbatim in any patch, so this case tests nothing`,
      );
    }
  } else if (injection !== null) {
    problems.push('only injection cases may declare injection text');
  }

  if (problems.length > 0) {
    return { problems: stamp(problems) };
  }

  const benchCase: BenchCase = {
    id: id as string,
    kind: kind as CaseKind,
    category: category as string,
    description: description as string,
    files,
    expected,
  };
  if (injection !== null) {
    benchCase.injection = injection;
  }

  return { benchCase, problems: [] };
}

/** Checks that hold across the corpus rather than within one case. */
export function validateCorpus(cases: readonly BenchCase[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const benchCase of cases) {
    if (seen.has(benchCase.id)) {
      // Ids key the results, so a duplicate silently overwrites a case and
      // shrinks the corpus without changing its reported size.
      problems.push(`duplicate case id ${benchCase.id}`);
    }
    seen.add(benchCase.id);
  }

  return problems;
}
