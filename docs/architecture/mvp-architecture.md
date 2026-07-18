# MergeCore V0.1 MVP Architecture

## Package responsibilities

MergeCore V0.1 keeps existing package paths and maps the conceptual layout as follows:

| Conceptual package | Path | npm name | Responsibility |
|--------------------|------|----------|----------------|
| core | `engine/intelligence/` | `@mergecore/intelligence` | Local indexing, parsing, graph storage, retrieval, shared contracts, public API |
| vscode-extension | `extension/` | `mergecore` | VS Code / Cursor UI, watchers, hover, review panel |
| mcp-server | `mcp/` | `@mergecore/mcp` | Stdio MCP tools for agents |
| shared | `engine/intelligence/contracts/` | exported from core | Pure TypeScript contracts and JSON codecs |
| test-fixtures | `packages/test-fixtures/` | `@mergecore/test-fixtures` | Miniature TS/JS repositories for automated tests |

The core package must not import `vscode`. Extension and MCP both depend on `@mergecore/intelligence` via `file:` links and share the same on-disk index.

## Public API

The documented entry point for creating and querying a repository index is:

```ts
import { createRepositoryIndex } from '@mergecore/intelligence';

const repo = await createRepositoryIndex(workspaceRoot);
await repo.index();
const status = await repo.getStatus();
const result = await repo.retrieve('MySymbol');
const pack = await repo.buildContextPack('architecture overview');
await repo.close();
```

Lower-level helpers (`indexWorkspace`, `RagStore`, `retrieve`) remain available for the extension’s incremental watchers, but hosts should prefer `createRepositoryIndex` for new code.

## Indexing lifecycle

```
scan workspace (nested .gitignore + .mergecoreignore + defaults)
  → refuse symlink escapes / binaries / temp / oversized files
  → fingerprint (SHA-256 is authority; mtime is informational)
  → skip unchanged hashes (incremental)
  → LanguageAdapter.chunk / extractSymbols / extractDependencies
  → persist under configurable storage (default `.mergecore/rag`) via atomic tmp+rename
  → prune deleted paths on full index / rebuild
```

Public file-indexer API: `createRepositoryFileIndexer` → `startInitialIndex` / `applyFileChanges` / `getIndexStatus` / `rebuildIndex` / `dispose`. Cancellation via `AbortSignal`; work is chunked asynchronously so the extension host is not blocked.

## Instruction scoping

`createInstructionResolver` discovers AGENTS.md / CLAUDE.md (nested), README, CONTRIBUTING, ADRs, `.cursor/rules`, docs, and configured MergeCore context paths. For a target file it returns applicable instructions with source ranges, scope, document type, precedence, authorship, and classification confidence. Closer scoped AGENTS/CLAUDE outweigh parents; README/ADR are contextual only; generated memory never overrides human instructions; equal-precedence contradictions are returned explicitly via `findInstructionConflicts` / `explainInstructionPrecedence`.

## Retrieval lifecycle

```
query
  → exact symbol name match
  → path relevance (when the query looks like a path)
  → dependency neighbourhood (when pathHint is set)
  → lexical / FTS BM25 over chunks
  → optional vector boost only if embeddings were stored earlier
  → ContextClaim[] with SourceReference[] on every claim
  → optional ContextPack (+ InstructionDocument discovery)
```

When evidence is missing, results set `incomplete: true` and may include notes asking callers to treat answers as uncertain.

## Source attribution

Every factual claim returned by the public API carries one or more `SourceReference` values:

- `path` — workspace-relative file path
- `startLine` / `endLine` — 1-based inclusive range
- `sourceType` — `source` | `symbol` | `dependency` | `memory` | `config` | `instruction` | `lexical`
- optional `symbol` and `excerpt`

`ContextPack` aggregates claims, instruction documents, and the flattened reference list so agents can cite evidence without inventing structure.

## Deterministic vs optional LLM

| Deterministic (always) | Optional |
|------------------------|----------|
| Walk, ignore, fingerprint | `ModelProvider.embed` / Ollama embeddings |
| Language adapters (regex/heuristic) | `ModelProvider.complete` for summaries |
| Symbol and import-edge extraction | Extension hover prose via local Ollama |
| Lexical / FTS retrieval | Remote review API (secondary; not cognition core) |
| Context-pack assembly | |

LLMs may organise retrieved evidence; they are never the source of truth for repository facts.

## Privacy boundaries

- Source stays on the developer machine by default.
- Index files live under `.mergecore/rag/` and are gitignored inside that directory.
- No cloud backend is required for V0.1 cognition.
- File contents are not sent to an external service unless the user explicitly enables a model provider or review API.
- Secrets, binaries, dependency directories, and build output are skipped by default.
- Repository code is never executed by the indexer.

## Shared index (extension + MCP)

Both hosts open the same store path:

`{workspaceRoot}/.mergecore/rag/`

- Extension: indexes via `IndexerService` / core APIs while the user works in the editor.
- MCP: uses `createRepositoryIndex` with `MERGECORE_WORKSPACE` (or cwd) as the root.

Status tools report `fileCount`, `chunkCount`, `symbolCount`, `edgeCount`, and `storeDir` so agents can confirm they are talking to the same local index.

## Storage

`IndexStore` is implemented by `SqlJsIndexStore`, wrapping the existing `RagStore` (`sql.js` WASM/asm.js). This avoids native Node addons so the extension can run on macOS, Windows, and Linux. Embeddings are optional columns; V0.1 retrieval does not require them.
