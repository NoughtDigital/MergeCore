# Rewrite guidelines: Laravel Core Rules

These guidelines apply when MergeCore (or another tool) proposes **full-file rewrites**, **patches**, or **inline replacements**. They are tuned for **senior Laravel** production codebases.

## Principles

1. **Preserve behaviour** unless the finding is explicitly about incorrect behaviour. Do not “fix” business rules you do not fully see.
2. **Minimise blast radius**. Prefer the smallest change that removes the defect or smell.
3. **Stay idiomatic**: follow Laravel’s conventions for the layer you are editing (HTTP, domain, persistence, console).
4. **British English** in comments, docblocks, and user-facing strings you introduce.

## HTTP layer

- Prefer **type-hinted Form Requests** (`StoreXRequest`) over inline `$request->validate()` in controllers.
- Use **route model binding** and **implicit/explicit binding** instead of manual `findOrFail` where it clarifies intent.
- Keep controllers **thin**: delegate to **actions**, **services**, or **domain objects** when logic spans validation, authorisation, persistence, and side effects.

## Authorisation

- Prefer **`$this->authorize()`**, **`Gate::`**, **`@can`**, or **middleware** (`can:`, `ability:`) over scattered role string checks.
- For APIs, align with **policies** and **resource ownership**; avoid trusting IDs from the client without membership checks.

## Eloquent and queries

- Prefer **eager loading** (`with`, `load`, `loadMissing`) over lazy loading in loops, API resources, and Filament tables.
- Avoid **unbounded** `all()` / `get()` on user-driven listings; use **pagination**, **simple pagination**, or **cursors** as appropriate.
- Use **parameter binding** for raw expressions; never concatenate user input into SQL.

## Transactions

- Use **`DB::transaction`** for multi-step invariants (especially money, stock, ledger-like updates).
- Keep transactions **short**: no outbound HTTP, e-mail sends, or sleeps inside a transaction unless you have a compelling, documented reason.

## Queues and events

- Assume **retries**: make handlers **idempotent** or guard with **unique constraints** / **idempotency keys**.
- Surface failures: sensible **`$tries` / `$backoff`**, **`failed()`**, and **logging context** (without secrets).

## Testing

- **Feature tests** should assert **authorisation** (`assertForbidden`, guest redirects) where routes are protected.
- Use **`RefreshDatabase`** (or a deliberate alternative) when tests mutate the database.
- When using **`Http::fake`**, assert **outbound contracts** (`Http::assertSent`) where the integration matters.

## Filament / Livewire (when applicable)

- Keep **tenant and auth scopes** in queries; avoid `withoutGlobalScopes()` unless justified and documented.
- Move heavy side effects out of **form field callbacks** into **actions**, **jobs**, or **services** to keep UI reactive layers testable.

## Patches and diffs

- Prefer **unified diffs** that match the project’s line endings and indentation.
- Do not rename public API routes or class names unless the task explicitly includes a breaking change.

## What not to do

- Do not add **new Composer dependencies** in a rewrite unless the user or task explicitly allows it; prefer framework-first solutions.
- Do not strip **types**, **`readonly`**, or **constructor promotion** if the file already uses them—match the file’s modernity level.
- Do not introduce **parallel abstractions** (extra repositories/interfaces) for trivial CRUD unless the codebase already follows that pattern.

## PSR and style

- Respect **PSR-12** layout where relevant; do not fight an existing Pint/CS-Fixer configuration—focus on substance.
