/** Filled by detectors; frozen when exposed on `ProjectProfile`. */
export interface PhpStackInfo {
  hasComposerJson: boolean;
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

/**
 * A remembered project pattern — "this repo uses X" — detected from
 * filesystem evidence rather than inferred by the LLM. Findings can then
 * be critiqued against the conventions that already exist here.
 *
 * Pack-agnostic by design. Each convention has:
 *  - a stable {@link id} (namespaced by stack, e.g. "php:actions-pattern")
 *  - a human {@link label} ("Uses Actions pattern") for prompts and UIs
 *  - a {@link confidence} so low-signal hunches can be downweighted
 *  - optional {@link evidence} (paths, counts) kept small — the prompt
 *    needs enough to be precise but not a file listing.
 *
 * New detectors can add new conventions without schema changes; the
 * contract is intentionally forward-compatible.
 */
export interface ProjectConvention {
  /** Stable dot/colon namespaced id, e.g. "php:actions-pattern". */
  readonly id: string;
  /** One-line human label, used directly in prompts. */
  readonly label: string;
  /** "high" when multiple strong signals, "medium" for one strong, "low" for a hint. */
  readonly confidence: 'high' | 'medium' | 'low';
  /** Category hint — used for grouping in UI and prompt ordering. */
  readonly category:
    | 'architecture'
    | 'layering'
    | 'naming'
    | 'testing'
    | 'types'
    | 'data'
    | 'ui'
    | 'tooling'
    | 'other';
  /** Optional short evidence blob (≤ 2 strings recommended) to show reviewers. */
  readonly evidence?: readonly string[];
}

export interface ProjectProfile {
  readonly workspaceRoot: string;
  readonly collectedAt: number;
  readonly stacks: {
    readonly php: Readonly<PhpStackInfo>;
    readonly javascript: Readonly<JavascriptStackInfo>;
  };
  /** Deterministic tags for prompts and cache keys, e.g. "typescript", "react", "pest" */
  readonly signals: readonly string[];
  /**
   * Detected repository conventions — the "contextual memory" of the plugin.
   * Ordered by confidence (high first) then id. Empty when no conventions
   * were detected or the project is too small to judge.
   */
  readonly conventions: readonly ProjectConvention[];
  /** Short stable summary for APIs */
  readonly fingerprint: string;
}

export function emptyPhpStack(): PhpStackInfo {
  return {
    hasComposerJson: false,
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
