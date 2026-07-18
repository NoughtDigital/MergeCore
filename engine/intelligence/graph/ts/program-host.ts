import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { absToRel, normaliseRel, relToAbs, toPosix } from './paths';

export interface TsProjectState {
  readonly configPath: string;
  readonly options: ts.CompilerOptions;
  rootNames: string[];
  languageService: ts.LanguageService;
  host: ts.LanguageServiceHost;
  /** Absolute path → content override (indexed / edited buffers). */
  readonly fileContents: Map<string, string>;
  /** Absolute path → version string. */
  readonly versions: Map<string, string>;
  dirty: boolean;
}

function isConfigName(name: string): boolean {
  return (
    name === 'tsconfig.json' ||
    name === 'jsconfig.json' ||
    /^tsconfig\..+\.json$/.test(name)
  );
}

/**
 * Discover tsconfig / jsconfig files under a workspace (shallow-friendly walk).
 */
export function discoverTsConfigs(workspaceRoot: string): string[] {
  const root = path.resolve(workspaceRoot);
  const found: string[] = [];
  const skipDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'out',
    'coverage',
    '.mergecore',
    '.next',
    '.turbo',
  ]);

  const walk = (dir: string, depth: number): void => {
    if (depth > 8) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.') && ent.name !== '.') {
        if (ent.isDirectory() && skipDirs.has(ent.name)) {
          continue;
        }
      }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (skipDirs.has(ent.name)) {
          continue;
        }
        walk(full, depth + 1);
      } else if (ent.isFile() && isConfigName(ent.name)) {
        found.push(full);
      }
    }
  };

  walk(root, 0);
  // Prefer root configs first
  found.sort((a, b) => a.length - b.length);
  return found;
}

function createDefaultOptions(allowJs: boolean): ts.CompilerOptions {
  return {
    allowJs,
    checkJs: false,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    esModuleInterop: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.ReactJSX,
    baseUrl: undefined,
  };
}

function parseConfig(configPath: string): {
  options: ts.CompilerOptions;
  fileNames: string[];
} {
  const configFile = ts.readConfigFile(configPath, (p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return undefined;
    }
  });
  const dir = path.dirname(configPath);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config ?? {},
    {
      ...ts.sys,
      readDirectory: ts.sys.readDirectory,
      fileExists: ts.sys.fileExists,
      readFile: (p) => {
        try {
          return fs.readFileSync(p, 'utf8');
        } catch {
          return undefined;
        }
      },
    },
    dir
  );
  return {
    options: {
      ...parsed.options,
      skipLibCheck: true,
      noEmit: true,
    },
    fileNames: parsed.fileNames,
  };
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (lower.endsWith('.jsx')) {
    return ts.ScriptKind.JSX;
  }
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/**
 * Incremental TypeScript LanguageService host for one or more projects.
 */
export class TsProgramHost {
  private projects: TsProjectState[] = [];
  private readonly absToProject = new Map<string, TsProjectState>();
  private bootstrapped = false;

  constructor(readonly workspaceRoot: string) {}

  /** Discover configs and create language services. Safe to call repeatedly. */
  bootstrap(seedFiles?: ReadonlyMap<string, string>): void {
    const root = path.resolve(this.workspaceRoot);
    const configs = discoverTsConfigs(root);
    this.projects = [];
    this.absToProject.clear();

    if (configs.length === 0) {
      // Synthetic project covering all seed / disk TS/JS under root.
      const options = createDefaultOptions(true);
      options.baseUrl = root;
      const fileNames: string[] = [];
      if (seedFiles) {
        for (const rel of seedFiles.keys()) {
          fileNames.push(relToAbs(root, rel));
        }
      }
      this.addProject(path.join(root, 'tsconfig.mergecore.json'), options, fileNames, seedFiles);
    } else {
      for (const configPath of configs) {
        try {
          const { options, fileNames } = parseConfig(configPath);
          this.addProject(configPath, options, fileNames, seedFiles);
        } catch {
          // skip broken configs
        }
      }
    }
    this.bootstrapped = true;
  }

  private addProject(
    configPath: string,
    options: ts.CompilerOptions,
    fileNames: string[],
    seedFiles?: ReadonlyMap<string, string>
  ): void {
    const root = path.resolve(this.workspaceRoot);
    const fileContents = new Map<string, string>();
    const versions = new Map<string, string>();
    const rootSet = new Set(fileNames.map((f) => path.resolve(f)));

    if (seedFiles) {
      for (const [rel, content] of seedFiles) {
        const abs = relToAbs(root, rel);
        fileContents.set(abs, content);
        versions.set(abs, '1');
        rootSet.add(abs);
      }
    }

    const rootNames = [...rootSet];
    const state: TsProjectState = {
      configPath,
      options,
      rootNames,
      fileContents,
      versions,
      dirty: false,
      languageService: null as unknown as ts.LanguageService,
      host: null as unknown as ts.LanguageServiceHost,
    };

    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => state.options,
      getScriptFileNames: () => [...state.rootNames],
      getScriptVersion: (fileName) => state.versions.get(path.resolve(fileName)) ?? '0',
      getScriptSnapshot: (fileName) => {
        const abs = path.resolve(fileName);
        const override = state.fileContents.get(abs);
        if (override !== undefined) {
          return ts.ScriptSnapshot.fromString(override);
        }
        try {
          if (!fs.existsSync(abs)) {
            return undefined;
          }
          const text = fs.readFileSync(abs, 'utf8');
          return ts.ScriptSnapshot.fromString(text);
        } catch {
          return undefined;
        }
      },
      getCurrentDirectory: () => root,
      getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
      fileExists: (f) => {
        const abs = path.resolve(f);
        return state.fileContents.has(abs) || ts.sys.fileExists(f);
      },
      readFile: (f) => {
        const abs = path.resolve(f);
        if (state.fileContents.has(abs)) {
          return state.fileContents.get(abs);
        }
        return ts.sys.readFile(f);
      },
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      realpath: ts.sys.realpath,
      getScriptKind: (fileName) => scriptKindFor(fileName),
    };

    state.host = host;
    state.languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
    this.projects.push(state);

    for (const abs of rootNames) {
      if (!this.absToProject.has(abs)) {
        this.absToProject.set(abs, state);
      }
    }
  }

  ensureBootstrapped(seedFiles?: ReadonlyMap<string, string>): void {
    if (!this.bootstrapped) {
      this.bootstrap(seedFiles);
    }
  }

  /** Update or insert a file buffer and bump script version. */
  updateFile(relPath: string, content: string): void {
    this.ensureBootstrapped();
    const abs = relToAbs(this.workspaceRoot, relPath);
    let project = this.absToProject.get(abs);
    if (!project) {
      // Attach to the first / best project
      project = this.projects[0];
      if (!project) {
        this.bootstrap(new Map([[normaliseRel(relPath), content]]));
        project = this.absToProject.get(abs) ?? this.projects[0];
      }
      if (project && !project.rootNames.includes(abs)) {
        project.rootNames = [...project.rootNames, abs];
        this.absToProject.set(abs, project);
      }
    }
    if (!project) {
      return;
    }
    const prev = project.versions.get(abs);
    const next = prev ? String(Number(prev) + 1) : '1';
    project.fileContents.set(abs, content);
    project.versions.set(abs, next);
    project.dirty = true;
  }

  removeFile(relPath: string): void {
    const abs = relToAbs(this.workspaceRoot, relPath);
    const project = this.absToProject.get(abs);
    if (!project) {
      return;
    }
    project.fileContents.delete(abs);
    project.versions.delete(abs);
    project.rootNames = project.rootNames.filter((f) => f !== abs);
    this.absToProject.delete(abs);
    project.dirty = true;
  }

  getProjectForFile(relPath: string): TsProjectState | undefined {
    this.ensureBootstrapped();
    const abs = relToAbs(this.workspaceRoot, relPath);
    return this.absToProject.get(abs) ?? this.projects[0];
  }

  getProgram(relPath: string): ts.Program | undefined {
    const project = this.getProjectForFile(relPath);
    return project?.languageService.getProgram() ?? undefined;
  }

  getSourceFile(relPath: string): ts.SourceFile | undefined {
    const program = this.getProgram(relPath);
    if (!program) {
      return undefined;
    }
    const abs = relToAbs(this.workspaceRoot, relPath);
    return (
      program.getSourceFile(abs) ??
      program.getSourceFile(toPosix(abs)) ??
      program.getSourceFiles().find((sf) => path.resolve(sf.fileName) === abs)
    );
  }

  getChecker(relPath: string): ts.TypeChecker | undefined {
    return this.getProgram(relPath)?.getTypeChecker();
  }

  resolveModule(
    fromRel: string,
    specifier: string
  ): { resolvedRel?: string; usedPathAlias: boolean } {
    const project = this.getProjectForFile(fromRel);
    if (!project) {
      return { usedPathAlias: false };
    }
    const containing = relToAbs(this.workspaceRoot, fromRel);
    const result = ts.resolveModuleName(
      specifier,
      containing,
      project.options,
      project.host
    );
    const resolved = result.resolvedModule?.resolvedFileName;
    if (!resolved) {
      return { usedPathAlias: false };
    }
    const abs = path.resolve(resolved);
    if (abs.includes(`${path.sep}node_modules${path.sep}`)) {
      return {
        resolvedRel: normaliseRel(absToRel(this.workspaceRoot, abs)),
        usedPathAlias: false,
      };
    }
    const rel = absToRel(this.workspaceRoot, abs);
    const usedPathAlias =
      Boolean(project.options.paths) && !specifier.startsWith('.') && !path.isAbsolute(specifier);
    return { resolvedRel: normaliseRel(rel), usedPathAlias };
  }

  /** Files belonging to any project (relative). */
  allProjectRelPaths(): string[] {
    this.ensureBootstrapped();
    const out = new Set<string>();
    for (const abs of this.absToProject.keys()) {
      out.add(normaliseRel(absToRel(this.workspaceRoot, abs)));
    }
    return [...out];
  }

  invalidateProjects(): void {
    for (const p of this.projects) {
      p.dirty = true;
    }
  }

  dispose(): void {
    for (const p of this.projects) {
      p.languageService.dispose();
    }
    this.projects = [];
    this.absToProject.clear();
    this.bootstrapped = false;
  }
}
