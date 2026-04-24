# Agent instructions: MergeCore Swift rules pack

Use this pack when the review unit is a **Swift** file (`.swift`). Hosts may expose **`swift: true`** in project metadata.

## Focus areas (priority)

1. **Optional safety** — avoid `!`/`as!`; prefer `guard let`, `if let`, `as?`.
2. **Concurrency** — respect actor isolation; cancel Tasks; keep the main actor responsive.
3. **Memory** — use `[weak self]`/`[unowned self]` on escaping closures when ownership permits.
4. **Error handling** — prefer `throws`/`Result` over `try!` and legacy (T?, Error?) callbacks.
5. **Security** — Keychain for secrets; structured logging via `os.Logger`.

## Evidence

- Quote the unwrap, capture list, Task block, or callback signature.
- If a finding depends on iOS/macOS version behaviour, mention it.

## British English

Use UK spelling in prose (*behaviour*, *authorisation*, *synchronisation*).

## When to stay quiet

- Formatting handled by SwiftFormat/SwiftLint.
- Value vs reference decisions already justified by identity needs.
- UIKit/AppKit tradeoffs — defer SwiftUI-specific findings to `mergecore-swiftui-rules`.

## Scoring

Hosts apply **`rubric.json` → `scoring`**: initial score **10**, subtract penalties, cap with **`max_total_penalty_per_file`**. Echo `rule.id` in findings.

## Shared rules: Explain Why (applies to every pack)

This pack inherits the **Explain Why (Critical)** and **Hidden side effects** rules from [../../AGENTS-SHARED.md](../../AGENTS-SHARED.md). Every finding at severity critical, error or warning must include a `why_it_matters` that teaches a concrete cost; any hidden side effect in the reviewed code must be named explicitly in the title or message. The MergeCore engine and extension audit this centrally, so this pack does not need to restate the bar — but authors editing the rubric should keep rule descriptions consistent with it.
