// Bundles the benchmark command-line entry points.
//
// The harness is written in TypeScript so it is typechecked and unit tested
// alongside the action it measures, and Node 20 cannot execute TypeScript, so
// the scripts bundle before they run. Output is transient and gitignored: it is
// a developer tool, not a published artifact like dist/.
import { build } from 'esbuild';

await build({
  entryPoints: ['bench/src/cli/bench.ts', 'bench/src/cli/scorecard.ts'],
  outdir: 'bench/dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // The corpus loads relative to its own module URL, which the bundle rewrites.
  // Keeping the loader external would break that, so cases resolve from an
  // explicit path the CLI passes instead.
  banner: {
    js: [
      "import { createRequire as __benchCreateRequire } from 'node:module';",
      'const require = __benchCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
