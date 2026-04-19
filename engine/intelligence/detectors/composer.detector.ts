import type { DetectorContext } from '../context';

type ComposerJson = {
  require?: Record<string, string>;
  'require-dev'?: Record<string, string>;
};

function mergeRequires(c: ComposerJson): Record<string, string> {
  return { ...c.require, ...c['require-dev'] };
}

function hasPackage(req: Record<string, string>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(req, name);
}

function findFilament(req: Record<string, string>): boolean {
  for (const k of Object.keys(req)) {
    if (k === 'filament/filament' || k.startsWith('filament/')) {
      return true;
    }
  }
  return false;
}

export async function detectComposer(ctx: DetectorContext): Promise<void> {
  const raw = await ctx.readJson<ComposerJson>('composer.json');
  if (!raw) {
    return;
  }

  ctx.php.hasComposerJson = true;

  const req = mergeRequires(raw);

  if (hasPackage(req, 'laravel/framework')) {
    ctx.php.isLaravel = true;
    ctx.php.laravelFrameworkVersion = req['laravel/framework'];
  }

  if (findFilament(req)) {
    ctx.php.filament = true;
  }
  if (hasPackage(req, 'livewire/livewire')) {
    ctx.php.livewire = true;
  }
  if (hasPackage(req, 'pestphp/pest')) {
    ctx.php.pest = true;
  }
  if (hasPackage(req, 'phpunit/phpunit')) {
    ctx.php.phpunit = true;
  }
}
