# Agent instructions: MergeCore Alpine.js rules pack

Use this pack when views or assets use **Alpine.js** (`x-data`, `x-on`, `x-model`, `x-for`, `Alpine.data`, `$wire` in Blade). Hosts may expose **`alpine: true`** in project metadata.

## Focus areas (priority)

1. **Safe initial state** — never build `x-data` from raw user strings; prefer `@js()`, JSON endpoints, or static shapes.
2. **Lists** — stable keys on `x-for`; avoid reorder bugs and duplicate DOM nodes.
3. **Side effects** — `x-init` / `fetch` with loading and error handling; avoid silent failures.
4. **Maintainability** — extract large inline scripts to modules or `Alpine.data`; avoid mega `x-data` blobs.
5. **Livewire interop** — when both are present, shared fields should use `@entangle`, not parallel `x-model` and `wire:model`.

## Evidence

- Quote **Alpine** directives or `$wire` usage when flagging issues.
- If the file has no Alpine syntax and no Alpine imports, **do not** apply this pack unless the user asked for Alpine review.

## British English

Use UK spelling in prose (*authorisation*, *behaviour*).

## Scoring

Hosts apply **`rubric.json` → `scoring`**: initial score **10**, subtract penalties, cap with **`max_total_penalty_per_file`**. Optional **`alpine_overrides.interactive_view_multiplier`** may apply to **security** and **correctness** rules in files with many `x-on` or `x-model` bindings.

## Cross-reference

Map triage labels to **`smells.json`**; canonical ids are in **`rubric.json` → `rules`**.
