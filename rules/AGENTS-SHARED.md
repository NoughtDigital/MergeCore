# Shared agent rules (apply to every MergeCore pack)

These rules are enforced centrally by the MergeCore engine and the extension.
They apply to **every pack** — current and future. Individual packs never opt
out, and new packs inherit them automatically without needing to restate them.

Per-pack `agents.md` files should cite this document rather than duplicate it;
packs remain the source of truth for their **content** (priority areas, stack
stance, focus, silence rules) while this document is the source of truth for
**how every finding must read**.

---

## Explain Why (Critical)

Every criticism must teach. A finding that labels a problem without explaining
why it is a problem — and what silently breaks when it ships — leaves the
reader with nothing to reuse on the next file they touch. That is a defect in
the review, not a feature.

For every finding at severity **critical**, **error** or **warning**:

1. **`why_it_matters` is required** and must name at least one concrete cost
   from: outage, data loss or corruption, secret leak, exploit or injection,
   race or deadlock, N+1 or other runtime hazard, broken caller contract,
   unreviewable change surface, onboarding cost, revert cost, test gap.
2. **Vague risk framings are banned.** "May cause issues", "could be
   problematic", "not ideal practice", and similar hedges are treated as if
   the field were missing.
3. **`why_it_matters` must not restate the title or message.** If you have
   nothing new to teach on top of the headline, drop the finding — a label
   without a lesson is not worth the reader's attention.

Findings at severity **info** / **hint** are allowed to be terse observations,
but still follow the comment-strength rules (no "Consider…", "Maybe…",
"needs work", bare "refactor").

## Hidden side effects are first-class

Hidden side effects are the single most expensive thing to discover at runtime
and the hardest to explain to a new teammate. When reviewed code does any of
the following and the visible code does not make it obvious, the finding
**must**:

- use one of the signal phrases — `silently`, `implicit`, `hidden`, `shadow`,
  `swallows errors`, `suppresses exceptions`, `leaks state`, `side effect`,
  `under the hood`, `behind the scenes`, `monkey-patch`, `unexpected` — in
  the title or message (the host highlights these), AND
- describe the concrete effect in `why_it_matters`: what runs, what state
  changes, what a future caller or reader will be surprised by.

Examples of patterns that qualify:

- `try { … } catch { /* no-op */ }` or an overly broad catch that swallows
  errors and returns a default.
- Functions that mutate arguments, module-level caches, or caller-owned
  objects in addition to returning a value.
- Implicit type coercion at a boundary (stringly-typed numbers, dates parsed
  from locale-sensitive strings, JSON without schema).
- Module-load-time side effects: monkey-patches, global registries mutated
  on import, ambient environment reads.
- Name shadowing that hides an outer binding and changes behaviour
  unexpectedly.
- Implicit context dependencies (request-bound globals, thread locals,
  "current user" state read out of middleware).

## Enforcement

The engine runs a pack-agnostic teaching audit on every review response. It
annotates findings with a short side-effect signal word, flags critical /
error / warning findings that ship without a substantive `why_it_matters`,
and reports the gap back to the host. The host renders a dedicated
**Hidden side effect** line on flagged findings and a neutral **Reviewer
note** when the teaching audit failed. Packs do not need to wire any of this
— it works the same across TypeScript, React, Laravel, Python, Go, Swift,
Pytorch and every future pack by construction.
