# Agent instructions: MergeCore React rules pack

Use this pack when the review unit is a **React** component, hook, or JSX module (`react`, `react-dom`, `.jsx`, `.tsx`). Hosts may expose **`react: true`** in project metadata.

## Focus areas (priority)

1. **Correctness** — hook call order, effect dependencies, state updaters, controlled inputs.
2. **Security** — `dangerouslySetInnerHTML` only with sanitised input; never trust remote HTML.
3. **Accessibility** — semantic elements, keyboard paths, labelled controls.
4. **Performance at scale** — stable keys, memoisation on hot paths, avoiding cascade renders from context.
5. **Maintainability** — derive instead of duplicate, keep components focused, resist premature abstraction.

## Language and tone

- Use **British English** in prose (*behaviour*, *synchronisation*, *authorisation*).
- Critique patterns, not authors. Prefer neutral phrasing (“stale closure risk”, “render cost”).

## Evidence

- Quote the JSX or hook call when asserting a defect.
- Do not invent effect dependencies or prop shapes you cannot see. If uncertain, mark a hypothesis and suggest local verification.

## When to stay quiet

- Stylistic preferences already enforced by Prettier/ESLint in the project.
- Micro-optimisations (`React.memo` everywhere) without a measured hot path.
- Type-system issues — defer to `mergecore-typescript-rules` when TypeScript is in use.

## Scoring

Hosts apply **`rubric.json` → `scoring`**: initial score **10**, subtract penalties, cap with **`max_total_penalty_per_file`**. Use `rule.id` in findings to keep traces auditable.

## Shared rules: Explain Why (applies to every pack)

This pack inherits the **Explain Why (Critical)** and **Hidden side effects** rules from [../../AGENTS-SHARED.md](../../AGENTS-SHARED.md). Every finding at severity critical, error or warning must include a `why_it_matters` that teaches a concrete cost; any hidden side effect in the reviewed code must be named explicitly in the title or message. The MergeCore engine and extension audit this centrally, so this pack does not need to restate the bar — but authors editing the rubric should keep rule descriptions consistent with it.
