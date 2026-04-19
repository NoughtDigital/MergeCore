import type { DetectorContext } from '../context';

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function mergeDeps(p: PackageJson): Record<string, string> {
  return { ...p.dependencies, ...p.devDependencies, ...p.peerDependencies };
}

function has(dep: Record<string, string>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(dep, name);
}

export async function detectPackageJson(ctx: DetectorContext): Promise<void> {
  const pkg = await ctx.readJson<PackageJson>('package.json');
  if (!pkg) {
    return;
  }

  ctx.javascript.hasPackageJson = true;
  const dep = mergeDeps(pkg);

  if (has(dep, 'typescript') || has(dep, 'tsx')) {
    ctx.javascript.typeScript = true;
  }
  if (has(dep, 'react') || has(dep, 'react-dom')) {
    ctx.javascript.react = true;
  }
  if (has(dep, 'vue') || has(dep, 'nuxt')) {
    ctx.javascript.vue = true;
  }
  if (has(dep, 'vite') || has(dep, '@vitejs/plugin-vue') || has(dep, '@vitejs/plugin-react')) {
    ctx.javascript.vite = true;
  }
  if (has(dep, '@inertiajs/react') || has(dep, '@inertiajs/vue3') || has(dep, '@inertiajs/svelte')) {
    ctx.javascript.inertia = true;
  }
}
