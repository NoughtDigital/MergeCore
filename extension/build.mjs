#!/usr/bin/env node
/**
 * esbuild bundler for the MergeCore VS Code extension.
 *
 * Produces a single `out/extension.js` so the .vsix ships one JS payload
 * instead of a tree of individual files, which shortens activation time and
 * keeps `@mergecore/intelligence` inlined (no relative file: resolution at
 * runtime on user machines).
 */
import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify') || process.env.NODE_ENV === 'production';

const common = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  minify,
  external: ['vscode', 'sql.js'],
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(common);
  await ctx.watch();
} else {
  await esbuild.build(common);
}
