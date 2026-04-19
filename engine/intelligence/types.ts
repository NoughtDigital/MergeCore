/** Filled by detectors; frozen when exposed on `ProjectProfile`. */
export interface PhpStackInfo {
  hasComposerJson: boolean;
  isLaravel: boolean;
  /** From composer, e.g. "^11.0" */
  laravelFrameworkVersion?: string;
  filament: boolean;
  livewire: boolean;
  pest: boolean;
  phpunit: boolean;
}

/** Filled by detectors; frozen when exposed on `ProjectProfile`. */
export interface JavascriptStackInfo {
  hasPackageJson: boolean;
  typeScript: boolean;
  react: boolean;
  vue: boolean;
  vite: boolean;
  inertia: boolean;
}

export interface ProjectProfile {
  readonly workspaceRoot: string;
  readonly collectedAt: number;
  readonly stacks: {
    readonly php: Readonly<PhpStackInfo>;
    readonly javascript: Readonly<JavascriptStackInfo>;
  };
  /** Deterministic tags for prompts and cache keys, e.g. "laravel", "filament", "pest" */
  readonly signals: readonly string[];
  /** Short stable summary for APIs */
  readonly fingerprint: string;
}

export function emptyPhpStack(): PhpStackInfo {
  return {
    hasComposerJson: false,
    isLaravel: false,
    filament: false,
    livewire: false,
    pest: false,
    phpunit: false,
  };
}

export function emptyJsStack(): JavascriptStackInfo {
  return {
    hasPackageJson: false,
    typeScript: false,
    react: false,
    vue: false,
    vite: false,
    inertia: false,
  };
}
