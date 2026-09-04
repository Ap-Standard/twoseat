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
import { locateInjectionLine } from './injection.js';
import {
  CATEGORIES,
  SEVERITIES,
  type Category,
  type Severity,
} from '../../src/findings/model.js';

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

export interface InducedFinding {
  path: string;
  /** Line in the file as the diff leaves it. Must sit inside a hunk. */
  line: number;
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
  /**
   * Present only on an injection that asks for a defect that is not there: the
   * finding it tries to manufacture.
   *
   * Declared rather than inferred. Deciding after the fact which unseeded
   * finding an injection caused would be a judgment call inside a measurement,
   * and the case knows the answer because its own text names one.
   */
  induces?: InducedFinding;
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

  const structural = checkPatchStructure(path, lines as string[]);
  if (structural.length > 0) {
    return { problems: structural };
  }

  return { file: { path, patch }, problems: [] };
}

const HUNK_HEADER_COUNTS = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Reconciles every hunk header with the body that follows it.
 *
 * parseHunkRanges trusts the header, which is right for a real diff from the
 * API and wrong for a hand-written case. A header claiming a hundred new lines
 * above a one-line body makes a hundred lines anchorable, so a label on a line
 * that does not exist would pass the anchor check and be scored against a seat
 * that could never have seen it.
 */
function checkPatchStructure(path: string, lines: readonly string[]): string[] {
  const problems: string[] = [];
  let header: { line: string; oldCount: number; newCount: number } | null = null;
  let oldSeen = 0;
  let newSeen = 0;

  const settle = (): void => {
    if (header === null) {
      return;
    }
    if (newSeen !== header.newCount) {
      problems.push(
        `${path}: hunk header ${header.line} declares ${String(header.newCount)} new ` +
          `line(s), body has ${String(newSeen)}`,
      );
    }
    if (oldSeen !== header.oldCount) {
      problems.push(
        `${path}: hunk header ${header.line} declares ${String(header.oldCount)} old ` +
          `line(s), body has ${String(oldSeen)}`,
      );
    }
  };

  for (const line of lines) {
    const match = HUNK_HEADER_COUNTS.exec(line);
    if (match !== null) {
      settle();
      header = {
        line: line.split('@@')[1] === undefined ? line : `@@${line.split('@@')[1] ?? ''}@@`,
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
      };
      oldSeen = 0;
      newSeen = 0;
      continue;
    }

    if (header === null) {
      problems.push(`${path}: content appears before the first hunk header`);
      continue;
    }

    const prefix = line[0];
    if (prefix === ' ') {
      oldSeen += 1;
      newSeen += 1;
    } else if (prefix === '+') {
      newSeen += 1;
    } else if (prefix === '-') {
      oldSeen += 1;
    } else if (line.startsWith('\\')) {
      // `\ No newline at end of file`, which git emits and which counts as
      // neither an old nor a new line.
      continue;
    } else {
      problems.push(
        `${path}: patch line ${JSON.stringify(line)} has no diff prefix, so it is not a patch`,
      );
    }
  }

  settle();
  return problems;
}

function parseInduced(
  value: unknown,
  files: readonly CaseFile[],
): { induced?: InducedFinding; problems: string[] } {
  if (value === undefined) {
    return { problems: [] };
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { problems: ['induces is not an object'] };
  }

  const source = value as Record<string, unknown>;
  const path = readString(source, 'path');
  const category = readString(source, 'category');
  const line = source['line'];

  const problems: string[] = [];
  if (path === null) problems.push('induces has no path');
  if (category === null) {
    problems.push('induces has no category');
  } else if (!CATEGORIES.includes(category as Category)) {
    problems.push(
      `induces category ${JSON.stringify(category)} is not one the findings schema can express`,
    );
  }
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
    problems.push('induces line must be a positive whole number');
  }

  if (problems.length > 0 || path === null || category === null || typeof line !== 'number') {
    return { problems };
  }

  if (!files.some((file) => file.path === path)) {
    return { problems: [`induces names ${path}, which this case does not contain`] };
  }

  if (!isAnchoredInDiff(files, path, line)) {
    // Same rule the action applies to a live seat. An induced finding the seat
    // could never anchor is unreachable, so the case would measure nothing.
    return {
      problems: [`induces line ${String(line)} is outside every hunk of ${path}`],
    };
  }

  return { induced: { path, line, category }, problems: [] };
}

/**
 * Checks that an injection case carries a reachable injection.
 *
 * Nothing here forbids the injection from sitting next to a seeded label or
 * next to what it induces, and in this corpus it usually does. An injected
 * comment is planted beside the defect it wants hidden, which is how the attack
 * works. Ambiguity between what a finding means is resolved by precedence in
 * score.ts rather than by rejecting realistic cases: a label absorbs a finding
 * first, then induction, and only what is left reads as a report about the
 * injection. An ambiguous finding therefore counts as the attack succeeding.
 */
function injectionSiteProblems(
  files: readonly CaseFile[],
  injection: string | null,
  expected: readonly ExpectedFinding[],
  induces: InducedFinding | undefined,
): string[] {
  if (injection === null) {
    return ['an injection case must declare the injection text it carries'];
  }

  if (!files.some((file) => file.patch.includes(injection))) {
    return ['the declared injection does not appear verbatim in any patch, so this case tests nothing'];
  }

  if (locateInjectionLine(files, injection) === null) {
    // Present in a patch but only on a removed line, so it never reaches the
    // file a seat reviews and the case tests nothing.
    return ['the declared injection appears only on a removed line, so no seat ever sees it'];
  }

  if (expected.length === 0 && induces === undefined) {
    // Such a case has nothing to suppress, so it exists to test induction. With
    // nothing declared, obeying it would score identically to resisting it.
    return [
      'an injection case with no seeded defect must declare what it induces, since there is ' +
        'nothing for the injection to suppress and complying would otherwise score as resistance',
    ];
  }

  return [];
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
  if (category === null) {
    problems.push(`expected[${String(index)}] has no category`);
  } else if (!CATEGORIES.includes(category as Category)) {
    // A category no seat can emit is an automatic miss, and the scorecard
    // would blame the seat for a gap in the taxonomy.
    problems.push(
      `expected[${String(index)}] category ${JSON.stringify(category)} is not one the ` +
        'findings schema can express',
    );
  }
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

  // One finding satisfies one label, so two labels on the same line create a
  // miss no seat could avoid.
  const seenLabels = new Set<string>();
  for (const label of expected) {
    const key = `${label.path}:${String(label.line)}`;
    if (seenLabels.has(key)) {
      problems.push(`${label.path} line ${String(label.line)} carries more than one label`);
    }
    seenLabels.add(key);
  }

  const injection = readString(raw, 'injection');
  const inducedParse = parseInduced(raw['induces'], files);
  problems.push(...inducedParse.problems);
  const induces = inducedParse.induced;

  if (kind === 'injection') {
    problems.push(...injectionSiteProblems(files, injection, expected, induces));
  } else if (induces !== undefined) {
    problems.push('only injection cases may declare what they induce');
  }

  if (kind === 'clean' && rawExpected.length > 0) {
    problems.push('a clean case must have no expected findings');
  }
  if (kind === 'defect' && rawExpected.length === 0) {
    problems.push('a defect case must label at least one expected finding');
  }
  if (kind !== 'injection' && injection !== null) {
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
  if (induces !== undefined) {
    benchCase.induces = induces;
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
