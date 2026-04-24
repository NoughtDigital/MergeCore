# Agent instructions: MergeCore Filament rules pack

Use this pack when the project runs **Filament** (typically `app/Filament/**`) and MergeCore (or your host) exposes **`filament: true`** in project metadata.

## Focus areas (priority)

1. **Tenancy leaks** — `getEloquentQuery`, global scopes, tenant IDs from the request. Treat as **highest severity**; quote exact code.
2. **Slow tables** — N+1 from columns, missing `with()` / `withCount()`, unbounded lists.
3. **Policies** — `viewAny`, `view`, `create`, `update`, `delete` aligned with Resource visibility and actions.
4. **Actions** — authorisation on custom actions; no long HTTP/mail on the Livewire thread.
5. **Forms** — side effects in `afterStateUpdated`, unbounded repeaters, excessive `live()`.
6. **Bloated resources** — oversized single files; suggest extraction, not drive-by refactors.

## Evidence

- Cite **Filament API usage** (e.g. `getEloquentQuery`, `TextColumn::make`, `Action::make`) when flagging issues.
- If the file is not under `app/Filament` or no Filament imports exist, **do not** apply `filament: true` rules unless the user explicitly asked for Filament review.

## British English

Use UK spelling in prose (*authorisation*, *behaviour*).

## Scoring

Hosts apply **`rubric.json` → `scoring`**: start at 10, subtract penalties per matched rule, cap total penalty per file. Use optional **`filament_overrides.table_hot_path_multiplier`** only if the engine supports it. Negative penalties (e.g. FIL-SR-001) reward good patterns.

## Cross-reference

Map human triage labels to **`smells.json`** `id` values; canonical rule text lives in **`rubric.json` → `rules`**.

## Shared rules: Explain Why (applies to every pack)

This pack inherits the **Explain Why (Critical)** and **Hidden side effects** rules from [../../AGENTS-SHARED.md](../../AGENTS-SHARED.md). Every finding at severity critical, error or warning must include a `why_it_matters` that teaches a concrete cost; any hidden side effect in the reviewed code must be named explicitly in the title or message. The MergeCore engine and extension audit this centrally, so this pack does not need to restate the bar — but authors editing the rubric should keep rule descriptions consistent with it.
