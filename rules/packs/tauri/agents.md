# Agent instructions: MergeCore Tauri rules pack

Use this pack when the review unit is a **Tauri** config, capability file, Rust command module, or frontend code invoking the Tauri API. Hosts may expose **`tauri: true`** in project metadata.

## Focus areas (priority)

1. **Capabilities** — grant the narrowest permissions per window; avoid globbed fs scopes.
2. **IPC validation** — `#[tauri::command]` functions must validate arguments before touching the OS.
3. **Webview boundary** — strong CSP, no `unsafe-inline`/`unsafe-eval`.
4. **Updater safety** — signature verification is non-negotiable.
5. **Shell/FS** — prefer fixed allowlists and canonicalised paths over open-ended APIs.

## Evidence

- Quote the capability JSON, command signature, or Cargo/TS invocation when flagging a defect.
- If version-specific (Tauri 1 vs 2), say so.

## British English

Use UK spelling in prose (*behaviour*, *authorisation*, *minimalise*).

## When to stay quiet

- Rust style choices already enforced by `clippy` and `rustfmt`.
- Sandbox trade-offs the team has explicitly documented.

## Scoring

Hosts apply **`rubric.json` → `scoring`**: initial score **10**, subtract penalties, cap with **`max_total_penalty_per_file`**. Echo `rule.id` in findings.
