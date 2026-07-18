/** Lightweight language id for privacy language-scoped rules (no scanner deps). */
export function languageForPrivacyPath(relPath: string): string {
  const lower = relPath.replace(/\\/g, '/').toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.mts') || lower.endsWith('.cts')) {
    return 'typescript';
  }
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs')
  ) {
    return 'javascript';
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'markdown';
  }
  if (lower.endsWith('.php') || lower.endsWith('.blade.php')) {
    return 'php';
  }
  if (lower.endsWith('.json')) {
    return 'json';
  }
  if (lower.endsWith('.py')) {
    return 'python';
  }
  if (lower.endsWith('.vue')) {
    return 'vue';
  }
  return 'generic';
}

export function extensionForPrivacyPath(relPath: string): string {
  const base = relPath.replace(/\\/g, '/').split('/').pop() ?? relPath;
  const lower = base.toLowerCase();
  if (lower.endsWith('.blade.php')) {
    return '.blade.php';
  }
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}
