# Agent instructions: MergeCore Livewire rules pack

Use this pack when the project uses **Livewire** (`app/Livewire/**`, `Livewire\Component`, `WithFileUploads`). Hosts may expose **`livewire: true`** in project metadata.

## Focus areas (priority)

1. **Authorisation** — `#[Authorize]`, `$this->authorize()`, or gates on actions; hidden UI is not a security boundary.
2. **Payloads** — avoid serialising entire Eloquent models or secrets in public properties; prefer ids, DTOs, or API resources.
3. **Request-thread work** — queue outbound HTTP, mail, and long loops; keep actions responsive.
4. **Performance** — `wire:model.live` with debounce or blur where appropriate; `wire:key` in loops; eager loading in `render()` / queries.
5. **Uploads and events** — `WithFileUploads`, validation rules, and small `dispatch()` payloads (ids, not whole models).

## Evidence

- Quote **Livewire** APIs when flagging issues.
- If the file is not a Livewire class or a Blade view that uses `wire:*` directives, **do not** apply this pack unless the user asked for Livewire review.

## British English

Use UK spelling in prose (*authorisation*, *behaviour*).

## Scoring

Hosts apply **`rubric.json` → `scoring`**: initial score **10**, subtract penalties, cap with **`max_total_penalty_per_file`**. Optional **`livewire_overrides.form_heavy_multiplier`** may apply to **performance** rules when the view has many `wire:model` bindings.

## Cross-reference

Map triage labels to **`smells.json`**; canonical ids and penalties are in **`rubric.json` → `rules`**.
