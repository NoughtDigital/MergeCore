# Agent instructions: MergeCore TypeScript rules pack

Use this pack when the review unit is a **TypeScript** file (`.ts`, `.tsx`) or `tsconfig*.json`. Hosts may expose **`typescript: true`** in project metadata.

## Focus areas (priority)

1. **Soundness at boundaries** — validate external input (HTTP, JSON, env) before typing.
2. **Narrowing over asserting** — prefer user-defined guards and discriminated unions over `as T` and `!`.
3. **Config** — keep `strict` on; scope escape hatches to files, not the whole project.
4. **Maintainability** — avoid baroque conditional types; prefer interfaces when mapping is fixed.
5. **Ecosystem hygiene** — `import type`, no accidental `any`, stable enums.

## Evidence

- Quote the offending type annotation, assertion, or cast.
- If the file relies on surrounding modules to be safe, say so and suggest where to verify.

## British English

Use UK spelling in prose (*behaviour*, *serialise*, *authorisation*).

## When to stay quiet

- Cosmetic formatting controlled by Prettier/ESLint.
- Correct uses of `any` at well-documented compatibility boundaries (e.g. third-party typings).
- Framework-specific rules — defer to `mergecore-react-rules`, `mergecore-vue-rules`, etc.

## Scoring

Hosts apply **`rubric.json` → `scoring`**: initial score **10**, subtract penalties, cap with **`max_total_penalty_per_file`**. Echo `rule.id` in findings.
