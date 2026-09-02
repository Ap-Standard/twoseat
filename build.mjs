// Bundles the action into a single ESM file that the node20 runtime executes
// directly. CI re-runs this and fails if the committed dist/ differs, so the
// bundle can never drift from source.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Some transitive dependencies still call require() at runtime. ESM output
  // has no require, so provide one built from the module's own URL.
  banner: {
    js: [
      "import { createRequire as __twoseatCreateRequire } from 'node:module';",
      'const require = __twoseatCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
