# Agent instructions: MergeCore Vue rules pack

Use this pack when the review unit is a **Vue 3** single-file component (`.vue`), composable (`use*.ts`/`use*.js`), or Pinia/Vuex store that accompanies Vue components. Hosts may expose **`vue: true`** in project metadata.

## Focus areas (priority)

1. **Reactivity correctness** — avoid destructuring reactive sources; respect one-way prop flow.
2. **Template safety** — never render user HTML without sanitisation; keep expressions small.
3. **Lifecycle discipline** — clean up timers, listeners, and observers.
4. **Contracts** — typed props and declared emits.
5. **Maintainability** — split fat composables; keep stores purposeful.

## Evidence

- Quote the directive, setup call, or defineProps/defineEmits line when asserting a defect.
- If behaviour depends on a parent component you cannot see, say so.

## British English

Use UK spelling in prose (*behaviour*, *serialise*, *synchronisation*).

## When to stay quiet

- Style controlled by Prettier/ESLint/eslint-plugin-vue.
- Vue 2 vs 3 differences — confirm version before flagging.
- Type-system concerns — defer to `mergecore-typescript-rules`.

## Scoring

Hosts apply **`rubric.json` → `scoring`**: initial score **10**, subtract penalties, cap with **`max_total_penalty_per_file`**. Echo `rule.id` in findings.
