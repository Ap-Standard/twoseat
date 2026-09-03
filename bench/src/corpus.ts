/**
 * Loading the corpus from disk.
 *
 * Separated from parsing so the validation logic stays pure and testable, and
 * so the only file access sits in one place. Cases load in filename order,
 * which keeps a run reproducible: the report lists results in a fixed order
 * whatever the filesystem returns.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCase, validateCorpus, type BenchCase } from './case.js';

/** Resolved from this module, so the loader works from any working directory. */
export const CASES_DIR = fileURLToPath(new URL('../cases', import.meta.url));

export interface CorpusLoad {
  cases: BenchCase[];
  problems: string[];
}

export function readCorpus(dir: string = CASES_DIR): CorpusLoad {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();

  const cases: BenchCase[] = [];
  const problems: string[] = [];

  for (const name of names) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (error: unknown) {
      problems.push(`${name}: is not valid JSON (${String(error)})`);
      continue;
    }

    const parsed = parseCase(raw, name);
    problems.push(...parsed.problems);
    if (parsed.benchCase !== undefined) {
      cases.push(parsed.benchCase);
    }
  }

  problems.push(...validateCorpus(cases));

  return { cases, problems };
}
