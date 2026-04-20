# Agent instructions: MergeCore SwiftUI rules pack

Use this pack when the review unit is a SwiftUI **View**, **Scene**, or supporting model marked with `@Observable`/`ObservableObject`. Hosts may expose **`swiftui: true`** in project metadata. This pack **extends `mergecore-swift-rules`**; apply both.

## Focus areas (priority)

1. **State ownership** — choose `@State`, `@Binding`, `@StateObject`, `@ObservedObject`, `@Observable`/`@Bindable`, or `@Environment` deliberately.
2. **Identity** — `ForEach` needs stable identity; lists mutate predictably.
3. **Performance** — keep `body` cheap; lift work to models, `.task`, or background actors.
4. **Accessibility** — icon-only controls need labels; dynamic type and contrast respected.
5. **Modern APIs** — prefer `NavigationStack` and Observation over legacy equivalents.

## Evidence

- Quote the property wrapper line, the `ForEach` signature, or the body excerpt when flagging a defect.
- Note any iOS/macOS version dependency when recommending `@Observable`, `.task`, or `NavigationStack`.

## British English

Use UK spelling in prose (*behaviour*, *colour*, *authorisation*).

## When to stay quiet

- Stylistic layout choices with no defect.
- Teams choosing `@StateObject`-style architectures over Observation deliberately.

## Scoring

Hosts apply **`rubric.json` → `scoring`**: initial score **10**, subtract penalties, cap with **`max_total_penalty_per_file`**. Echo `rule.id` in findings.
