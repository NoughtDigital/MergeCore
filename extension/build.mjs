#!/usr/bin/env node
/**
 * esbuild bundler for the MergeCore VS Code extension.
 *
 * Produces a single `out/extension.js` so the .vsix ships one JS payload
 * instead of a tree of individual files, which shortens activation time and
 * keeps `@mergecore/intelligence` inlined (no relative file: resolution at
 * runtime on user machines).
 *
 * Also vendors `sql.js` (+ wasm / asm fallback) into `out/vendor/sql.js` so
 * the published .vsix does not depend on node_modules at runtime.
 */
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify') || process.env.NODE_ENV === 'production';

function vendorSqlJs() {
  const sqlMain = require.resolve('sql.js');
  // sqlMain ends at …/sql.js/dist/sql-wasm.js
  const pkgRoot = path.dirname(path.dirname(sqlMain));
  const destRoot = path.join(__dirname, 'out', 'vendor', 'sql.js');
  const distSrc = path.join(pkgRoot, 'dist');
  const distDest = path.join(destRoot, 'dist');

  fs.mkdirSync(distDest, { recursive: true });
  fs.copyFileSync(path.join(pkgRoot, 'package.json'), path.join(destRoot, 'package.json'));

  const needed = ['sql-wasm.js', 'sql-wasm.wasm', 'sql-asm.js'];
  for (const name of needed) {
    const src = path.join(distSrc, name);
    if (!fs.existsSync(src)) {
      throw new Error(`sql.js dist missing: ${src}`);
    }
    fs.copyFileSync(src, path.join(distDest, name));
  }

  console.log(`vendored sql.js → ${path.relative(__dirname, destRoot)}`);
}

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
  vendorSqlJs();
} else {
  await esbuild.build(common);
  vendorSqlJs();
}
