# MergeCore

**Understand codebases, not just generate code.** MergeCore is a local-first engineering cognition layer for VS Code and Cursor: it indexes your repository privately, retrieves architecture and markdown memory, and explains symbols on hover with junior or senior depth.

It is **not** another Copilot, autocomplete tool, or PR comment bot. Review commands remain as secondary tooling.

---

## What it is

| Layer | Role |
|--------|------|
| **VS Code / Cursor extension** | Local index, hover explanations, explanation modes; optional secondary review panel. |
| **Local RAG (`.mergecore/rag/`)** | Per-repo chunk store with lexical retrieval and optional Ollama embeddings. |
| **Markdown intelligence** | README, decisions, agents, `.cursorrules`, and Laravel pack memory. |
| **`@mergecore/intelligence`** | Workspace fingerprinting, prod-risk scan, and RAG indexing. |
| **Rules packs** | Versioned engineering guidance (Laravel-first depth). |

Philosophy: **security and correctness before micro-style**, **evidence from the repo**, **UK English**, **source stays local**.

---

## Screenshots

> Add images under `docs/assets/` and replace the paths below.

| | |
|---|---|
| **Review panel (score, summary, findings)** | ![Review panel](docs/assets/review-panel.png) |
| **Command palette / context menu** | ![Commands](docs/assets/commands.png) |
| **Diff review** | ![Git diff review](docs/assets/review-diff.png) |

---

## Install

### From source (development)

Requirements: **Node 20+**, **VS Code ≥ 1.85** (or Cursor).

```bash
git clone https://github.com/<org>/MergeCore.git
cd MergeCore/extension
npm install
npm run compile
```

Open the repo in VS Code, **Run → Start Debugging** and pick **Launch Extension**, or use **F1 → Developer: Install Extension from Location…** and select the `extension` folder.

### VSIX package

```bash
cd extension
npm install
npm run compile
npx @vscode/vsce package
```

Install the generated `.vsix` via **Extensions → … → Install from VSIX…**.

### First cognition run

1. Open a Laravel/PHP workspace.
2. Run **MergeCore: Index Repository**.
3. Run **MergeCore: Set Explanation Mode** (Junior or Senior).
4. Hover a PHP method or class for a six-section explanation.
5. Optional: run Ollama locally and set `mergecore.local.*` for richer explanations.

### Configuration

| Setting | Purpose |
|---------|---------|
| `mergecore.apiBaseUrl` | MergeCore API base URL (no trailing slash). |
| `mergecore.apiToken` | Bearer token; when set with `useMockReviewer: false`, reviews use the API. |
| `mergecore.useMockReviewer` | `true` (default) uses the built-in mock; set `false` when using a real token. |

Without a token, the extension uses the mock reviewer so you can validate wiring and UI.

---

## Commands

| Command ID | Title |
|------------|--------|
| `mergecore.reviewSelection` | MergeCore: Review Selection |
| `mergecore.reviewFile` | MergeCore: Review Active File |
| `mergecore.reviewGitDiff` | MergeCore: Review Git Diff (working tree) |
| `mergecore.reviewStagedDiff` | MergeCore: Review Staged Diff |
| `mergecore.showSidebar` | MergeCore: Open Review Panel |
| `mergecore.applyImprovedCode` | MergeCore: Apply Improved Code to Active Editor |
| `mergecore.applyPatch` | MergeCore: Apply Patch to Active Editor |

**Palette:** F1 → type `MergeCore`.

**Editor context:** Review selection (when text selected); review active file from context menu.

---

## Repository layout

```
extension/              # VS Code extension (TypeScript)
engine/
  intelligence/         # @mergecore/intelligence — workspace profile detection
  pipeline/             # Server review pipeline (cache, prompts, schema)
rules/
  registry.json         # Index of all packs (id, path, version, tags)
  packs/
    typescript/         # TypeScript rubric + smells + agents
    react/              # React-focused pack
    python/             # Python-focused pack
    go/                 # Go-focused pack
    <pack-name>/        # Additional language, framework, testing, or domain packs
```

---

## Rules pack files

Hosts list packs via **`rules/registry.json`**, then resolve filenames in each pack from that pack’s **`pack.json`** (paths in **`artifacts`** are relative to the pack directory).

### `pack.json` (manifest)

Machine-readable pack metadata: **`pack_id`**, **`version`**, optional **`schema_version`**, **`locale`**, human **`title`** / **`description`**, and a **`rubric_schema`** URL for validating **`rubric.json`**. Each pack ships its own schema at `https://www.mergecore.dev/schemas/<pack>-rules.schema.json` (source: `website/public/schemas/`), so the Swift pack points at `swift-rules.schema.json`, Python at `python-rules.schema.json`, and so on. The **`artifacts`** object names the files the pack publishes (typically **`rubric`**, **`smells`**, **`agents`**, and optionally others such as rewrite guidelines). **`tags`** help filtering; **`extends`** lists other packs this one builds on (empty if standalone). This file is the single place a runner looks to find everything else in the folder.

### `rubric.json` (canonical rules)

The **scoring and rules source of truth**: pack meta, **severity levels** and default penalties, **scoring** behaviour (how penalties combine into a score), and a **`rules`** array. Each rule has a stable **`id`**, **`category`**, **`severity`**, **`title`**, **`description`**, optional **`penalty`** overrides, and **`detection`** hints (globs, heuristics, patterns) for engines or reviewers. Some rules may be gated by stack metadata (for example Filament or Pest when those apply). Findings should reference these **`id`** values when they match so results stay traceable.

### `smells.json` (smell index)

A **human-oriented index** of named “smells” that point at **`rubric.json`** via **`rule_ref`**. Each entry usually includes an **`id`**, **`name`**, short **`summary`**, **`layers`** (e.g. security, performance), and **`typical_fix`** text. Use it for **triage and wording**; the full rule text and scoring live in **`rubric.json`**.

### `agents.md` (agent and reviewer instructions)

**Prose instructions** for LLM-assisted review, human review, and tools: role, **language and tone** (for example British English), **priority order** (security before nit-picks), how to apply **`rubric.json`** and **`smells.json`**, **evidence rules** (quote the diff, do not invent context), stack-specific stance, and **output shape** when the host does not supply its own schema. It does not replace **`rubric.json`**; it tells agents how to use the pack consistently.

### `prod-risks.json` (optional — **What Breaks In Prod?** scanner)

Optional data file consumed by the local, pack-aware **"What Breaks In Prod?"** scanner (`mergecore.scanProdRisks`). Declare it in `pack.json` under `artifacts.prod_risks` (see `packs/typescript/pack.json` and `packs/laravel-core/pack.json` for examples).

Each entry follows the `ProdRiskRule` shape exported from `@mergecore/intelligence` and must target one of the nine supported categories: `race-conditions`, `retry-duplication`, `no-transactions`, `bad-queue-retries`, `memory-leaks`, `n-plus-one`, `missing-indexes`, `no-rate-limits`, `weak-logging`. Rules are **data only** (regex sources, path filters, required workspace signals); no executable code is accepted from packs. Unknown categories and malformed rules are dropped silently so one bad entry cannot break the scanner for the whole repo. See the [engine source](engine/intelligence/prod-risks/types.ts) for the full contract. Built-ins ship with the engine; pack rules layer on top and can override a built-in by reusing its `id` and bumping `ruleVersion`.

---

## Roadmap

Rough priority—subject to change:

1. **API + auth** — Stable public API, token lifecycle, and clear error surfaces in the extension.
2. **Richer project profiles** — Stronger use of `projectProfile` in prompts and deterministic rules across packs, including dependencies, tests, entrypoints, runtime config, and framework signals.
3. **CI / headless** — Review on merge requests without the editor (same rules packs, same scoring model).
4. **IDE polish** — Inline decorations, export formats, and faster iteration on large diffs.
5. **Community rules packs** — Versioned packs, schema compatibility, and attribution across any language or framework a pack can describe.

If you need enterprise guarantees, treat the roadmap as direction—not a SLA—until versions are tagged and documented.

---

## Pack Awareness

- **Pack-first intent:** Review should follow the repo you are in through registered packs and fingerprints, whether that is a front end, API service, mobile app, ML project, framework app, or a mix.
- **System context:** The extension auto-scans bounded related context such as imports, entrypoints, tests, config, schema files, and nearby domain modules before sending a review request.
- **Ecosystem:** Optional packs can add framework-specific expectations without forcing every project through those assumptions.
- **Honesty:** Mock mode is explicit; production review belongs behind the API with your policies and retention rules.

MergeCore is not “another generic linter.” It is aimed at **merge-time judgement** that respects the packs active for the repository.

---

## Contributing

### Code

1. Fork and branch from `main` (or the default branch).
2. **`extension/`:** run `npm run compile` before opening a PR; keep changes focused.
3. **`engine/intelligence/`:** run `npm run build` in that package after TypeScript changes; the extension compile depends on it.
4. Match existing style: strict TypeScript, no drive-by refactors, British English in user-facing strings where you touch them.

### Rules packs

Packs live under **`rules/packs/<name>/`**. Add new packs by creating the folder (with `rubric.json`, `smells.json`, `agents.md`, and **`pack.json`**) and **registering** them in **`rules/registry.json`**. See the **Rules pack files** section for what each of those files is for.

- Keep **`rubric.json`** valid against the schema declared by that pack’s **`pack.json`**.
- Keep **rule IDs stable** or document breaking changes.
- Prefer **evidence-based detection hints** over vague advice.
- Bump **`version`** in both `pack.json` and `registry.json` when you ship breaking or meaningful changes.

### Issues

Open issues for bugs, schema mismatches, or pack content that misleads real applications. Feature requests are welcome; **sharp reproduction steps** beat broad asks.

---

## Licence

Specify your licence in `LICENCE` (or `LICENSE`) at the repository root when you publish.

---

**MergeCore** — review that aims to know which packs apply to your repo, then judge code through that context.
