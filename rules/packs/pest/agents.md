# Agent instructions: MergeCore Pest rules pack

Apply when tests use **Pest** (`it()`, `test()`, `describe()`) or when the host marks **`pest: true`** in project metadata. Many rules also apply to **PHPUnit**-style Laravel tests if patterns match.

## Detection focus (in priority order)

1. **Authorization** — guests and unauthorised users for protected routes; peer-denial for policy-bound actions.
2. **Failure paths** — validation errors, exceptions, HTTP errors, job retries; not only HTTP 200.
3. **Assertions** — avoid tautologies; prefer database, JSON, events, and outbound HTTP assertions.
4. **Brittleness** — stable data via factories, avoid fixed ids and wall-clock dependence without freezing time.
5. **Edge cases** — empty inputs, boundaries, invalid transitions.
6. **Factories** — unique columns, states for non-happy paths.

## Evidence rules

- Quote **test code** when claiming a gap (e.g. “no `assertForbidden` in this file”).
- Do not assume routes or policy names not shown in the input.
- Use **British English** in prose.

## Scoring

Hosts consume **`rubric.json` → `scoring`**: initial score **10**, subtract rule **penalty** values, apply **`max_total_penalty_per_file`**. Optional **`pest_specific.assertion_focus_multiplier`** may be applied by advanced hosts. **PESTR-015** applies a **negative** penalty (reward).

## Mapping

Use **`smells.json`** for quick labels; **`rubric.json`** is canonical for ids and penalties.
