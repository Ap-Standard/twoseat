// Bundles the action into a single ESM file that the node24 runtime executes
// directly. CI re-runs this and fails if the committed dist/ differs, so the
// bundle can never drift from source.
//
// node24 rather than node20 since v0.1.0: GitHub's runners removed Node 20 on
// 2026-09-23. bench/build.mjs stays on node20 because CI executes that bundle
// under actions/setup-node 20, and the two targets are independent.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
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
