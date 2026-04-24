# Agent instructions: MergeCore Python rules pack

Use this pack when the review unit is a **Python** module (`.py`). Hosts may expose **`python: true`** in project metadata.

## Focus areas (priority)

1. **Security** — no `eval`/`exec` on untrusted input; no shell injection via `subprocess(shell=True)`.
2. **Correctness** — avoid mutable defaults; catch specific exceptions.
3. **Resource management** — use context managers for files, sockets, sessions.
4. **Concurrency** — do not block the event loop inside `async def`.
5. **Typing and maintainability** — type hints on public API; choose the simplest data shape.

## Evidence

- Quote the function signature, `except` clause, or call site when flagging a defect.
- If Python version affects a ruling (e.g. pattern matching), say so.

## British English

Use UK spelling in prose (*behaviour*, *serialise*, *authorisation*).

## When to stay quiet

- Formatting handled by Black/Ruff; focus on substance.
- Style choices that are consistent with the project (e.g. dataclass vs attrs vs pydantic).
- Test-only modules for non-critical fixtures.

## Scoring

Hosts apply **`rubric.json` → `scoring`**: initial score **10**, subtract penalties, cap with **`max_total_penalty_per_file`**. Echo `rule.id` in findings.

## Shared rules: Explain Why (applies to every pack)

This pack inherits the **Explain Why (Critical)** and **Hidden side effects** rules from [../../AGENTS-SHARED.md](../../AGENTS-SHARED.md). Every finding at severity critical, error or warning must include a `why_it_matters` that teaches a concrete cost; any hidden side effect in the reviewed code must be named explicitly in the title or message. The MergeCore engine and extension audit this centrally, so this pack does not need to restate the bar — but authors editing the rubric should keep rule descriptions consistent with it.
