# Agent instructions: MergeCore Go rules pack

Use this pack when the review unit is a **Go** file (`.go`). Hosts may expose **`go: true`** in project metadata.

## Focus areas (priority)

1. **Error handling** — never ignore errors; wrap with `%w` and meaningful prefixes.
2. **Context** — propagate `ctx` instead of creating fresh `context.Background`.
3. **Concurrency** — bound goroutines with `sync.WaitGroup`, `errgroup`, or `ctx.Done`; protect shared state.
4. **Resource safety** — `defer Close`; set HTTP timeouts; handle `sql.Rows` closure.
5. **Security** — parameterised SQL; never concatenate input.

## Evidence

- Quote the offending error-handling block, goroutine launch, or SQL call.
- If a finding depends on a goroutine lifecycle in a different file, say so.

## British English

Use UK spelling in prose (*behaviour*, *synchronisation*, *authorisation*).

## When to stay quiet

- gofmt/goimports cosmetics.
- Interface granularity disputes in small, consistent code.
- Generics style in teams that have deliberately chosen otherwise.

## Scoring

Hosts apply **`rubric.json` → `scoring`**: initial score **10**, subtract penalties, cap with **`max_total_penalty_per_file`**. Echo `rule.id` in findings.
