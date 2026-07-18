import * as fs from 'fs/promises';
import * as path from 'path';
import {
  CONFIG_PATH,
  CONTEXT_PACKS_DIR,
  EXPLANATIONS_DIR,
  GENERATED_DIR,
  GENERATED_MEMORY_DIR,
  MEMORY_DIR,
  MERGECORE_DIR,
  PROVENANCE_PATH,
  RAG_DIR,
  SHAREABLE_MEMORY_FILES,
} from './paths';
import {
  DEFAULT_MERGECORE_CONFIG,
  type MergeCoreConfig,
} from './types';
import { emptyProvenanceGraph, saveProvenanceGraph } from './provenance';

export interface InitMemoryResult {
  readonly created: readonly string[];
  readonly skipped: readonly string[];
  readonly config: MergeCoreConfig;
}

const HUMAN_TEMPLATES: Record<string, string> = {
  'architecture.md': `# Architecture

<!-- Human-authored. MergeCore will not silently rewrite this file. -->

## Overview

_Describe the system shape, boundaries, and key modules._

## Key modules

- 

## Data flow

- 
`,
  'conventions.md': `# Conventions

<!-- Human-authored. MergeCore will not silently rewrite this file. -->

## Coding standards

- 

## Review expectations

- 
`,
  'integrations.md': `# Integrations

<!-- Human-authored. MergeCore will not silently rewrite this file. -->

## External systems

- 

## Auth / webhooks

- 
`,
  'glossary.md': `# Glossary

<!-- Human-authored. MergeCore will not silently rewrite this file. -->

| Term | Meaning |
|------|---------|
|      |         |
`,
  'risks.md': `# Risks

<!-- Human-authored. MergeCore will not silently rewrite this file. -->

## Known risks

- 

## Mitigations

- 
`,
};

/**
 * Create the persistent `.mergecore` layout. Never overwrites existing
 * human-authored memory files.
 */
export async function initialiseMergeCoreMemory(
  workspaceRoot: string,
  options: { forceConfig?: boolean } = {}
): Promise<InitMemoryResult> {
  const created: string[] = [];
  const skipped: string[] = [];

  const dirs = [
    MERGECORE_DIR,
    MEMORY_DIR,
    GENERATED_DIR,
    GENERATED_MEMORY_DIR,
    CONTEXT_PACKS_DIR,
    EXPLANATIONS_DIR,
    RAG_DIR,
  ];

  for (const rel of dirs) {
    const abs = path.join(workspaceRoot, rel);
    try {
      await fs.mkdir(abs, { recursive: true });
      created.push(rel);
    } catch {
      skipped.push(rel);
    }
  }

  // Config
  const configAbs = path.join(workspaceRoot, CONFIG_PATH);
  let config = DEFAULT_MERGECORE_CONFIG;
  let configExists = false;
  try {
    await fs.access(configAbs);
    configExists = true;
  } catch {
    configExists = false;
  }
  if (!configExists || options.forceConfig) {
    await fs.writeFile(
      configAbs,
      `${JSON.stringify(DEFAULT_MERGECORE_CONFIG, null, 2)}\n`,
      'utf8'
    );
    created.push(CONFIG_PATH);
  } else {
    skipped.push(CONFIG_PATH);
    try {
      config = {
        ...DEFAULT_MERGECORE_CONFIG,
        ...(JSON.parse(await fs.readFile(configAbs, 'utf8')) as MergeCoreConfig),
      };
    } catch {
      config = DEFAULT_MERGECORE_CONFIG;
    }
  }

  // Shareable human memory templates — never overwrite
  for (const name of SHAREABLE_MEMORY_FILES) {
    const rel = `${MEMORY_DIR}/${name}`;
    const abs = path.join(workspaceRoot, rel);
    try {
      await fs.access(abs);
      skipped.push(rel);
    } catch {
      await fs.writeFile(abs, HUMAN_TEMPLATES[name] ?? `# ${name}\n`, 'utf8');
      created.push(rel);
    }
  }

  // Gitignore machine-local index + generated artefacts
  const ignoreRel = `${MERGECORE_DIR}/.gitignore`;
  const ignoreAbs = path.join(workspaceRoot, ignoreRel);
  const ignoreBody = [
    '# Machine-local MergeCore data — do not commit large indexes',
    'rag/',
    'generated/',
    '!.gitignore',
    '',
  ].join('\n');
  try {
    await fs.access(ignoreAbs);
    skipped.push(ignoreRel);
  } catch {
    await fs.writeFile(ignoreAbs, ignoreBody, 'utf8');
    created.push(ignoreRel);
  }

  // Keep empty dirs trackable if someone force-adds generated — optional keepers
  for (const keep of [
    `${GENERATED_DIR}/.gitkeep`,
    `${CONTEXT_PACKS_DIR}/.gitkeep`,
    `${EXPLANATIONS_DIR}/.gitkeep`,
    `${GENERATED_MEMORY_DIR}/.gitkeep`,
  ]) {
    const abs = path.join(workspaceRoot, keep);
    try {
      await fs.access(abs);
      skipped.push(keep);
    } catch {
      // generated/ is gitignored; .gitkeep is still useful locally
      await fs.writeFile(abs, '', 'utf8');
      created.push(keep);
    }
  }

  // Provenance graph seed
  try {
    await fs.access(path.join(workspaceRoot, PROVENANCE_PATH));
    skipped.push(PROVENANCE_PATH);
  } catch {
    await saveProvenanceGraph(workspaceRoot, emptyProvenanceGraph());
    created.push(PROVENANCE_PATH);
  }

  return { created: [...new Set(created)], skipped: [...new Set(skipped)], config };
}

export async function loadMergeCoreConfig(
  workspaceRoot: string
): Promise<MergeCoreConfig> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, CONFIG_PATH), 'utf8');
    return { ...DEFAULT_MERGECORE_CONFIG, ...(JSON.parse(raw) as MergeCoreConfig) };
  } catch {
    return DEFAULT_MERGECORE_CONFIG;
  }
}
