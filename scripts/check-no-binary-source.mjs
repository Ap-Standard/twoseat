/**
 * Fails when a tracked source or documentation file contains a NUL byte.
 *
 * Git treats such a file as binary, and the pull request files API then returns
 * it with no patch. The review gate never sees its contents, so any defect
 * inside it is invisible by construction. That happened once in this
 * repository: a literal separator byte in a template string made the module
 * that validates untrusted seat output unreviewable by the very gate it
 * belongs to.
 *
 * A dedicated check exists because no unit test can catch this. The code runs
 * correctly with the byte in place; what breaks is the file's reviewability.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.md',
  '.yml',
  '.yaml',
  '.sh',
  '.txt',
  '.gitignore',
  '.gitattributes',
]);

/** Generated bundles are checked in and legitimately hold whatever esbuild emits. */
const EXEMPT_PREFIXES = ['dist/'];

function extensionOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(dot);
}

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((path) => path !== '');

const offenders = [];

for (const path of tracked) {
  if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    continue;
  }
  if (!TEXT_EXTENSIONS.has(extensionOf(path))) {
    continue;
  }

  const contents = readFileSync(path);
  const at = contents.indexOf(0);
  if (at !== -1) {
    offenders.push({ path, at });
  }
}

if (offenders.length > 0) {
  for (const { path, at } of offenders) {
    console.log(
      `::error file=${path}::Contains a NUL byte at offset ${at}. Git treats this ` +
        'file as binary, so the pull request files API returns it without a patch ' +
        'and the review gate can never see it. Replace the byte.',
    );
  }
  process.exit(1);
}

console.log(`No NUL bytes in ${tracked.length} tracked files.`);
