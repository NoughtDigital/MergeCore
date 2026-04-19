import type { DetectorContext } from '../context';

export async function detectPathSignals(ctx: DetectorContext): Promise<void> {
  const artisan = await ctx.exists('artisan');
  const bootstrapApp = await ctx.exists('bootstrap/app.php');
  const appDir = await ctx.exists('app');
  const pestFile = await ctx.exists('pest.php');
  const phpunitXml = (await ctx.exists('phpunit.xml')) || (await ctx.exists('phpunit.xml.dist'));
  const viteTs = (await ctx.exists('vite.config.ts')) || (await ctx.exists('vite.config.mts'));
  const viteJs = await ctx.exists('vite.config.js');
  const tsconfig = (await ctx.exists('tsconfig.json')) || (await ctx.exists('jsconfig.json'));

  if (artisan) {
    ctx.extraSignals.push('path:artisan');
  }
  if (bootstrapApp && appDir) {
    ctx.extraSignals.push('path:laravel-skeleton');
    if (!ctx.php.isLaravel) {
      ctx.php.isLaravel = true;
    }
  }
  if (pestFile) {
    ctx.php.pest = true;
    ctx.extraSignals.push('path:pest.php');
  }
  if (phpunitXml) {
    ctx.php.phpunit = true;
    ctx.extraSignals.push('path:phpunit');
  }
  if (viteTs || viteJs) {
    ctx.javascript.vite = true;
    ctx.extraSignals.push('path:vite.config');
  }
  if (tsconfig) {
    ctx.javascript.typeScript = true;
    ctx.extraSignals.push('path:tsconfig');
  }
}
