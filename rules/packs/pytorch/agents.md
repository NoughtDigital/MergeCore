# Agent instructions: MergeCore PyTorch rules pack

Use this pack when the review unit imports **torch** (training scripts, model modules, dataloaders, utilities). Hosts may expose **`pytorch: true`** in project metadata. This pack **extends `mergecore-python-rules`**; apply both when scoring.

## Focus areas (priority)

1. **Gradient correctness** — `zero_grad`, `backward`, `optimizer.step` order; no softmax before `CrossEntropyLoss`.
2. **Train/eval discipline** — `model.eval()` and `torch.no_grad()` during validation.
3. **Device portability** — a single `device` variable over hard-coded `.cuda()`.
4. **Memory** — detach before storing; stream metrics as scalars.
5. **Performance** — DataLoader workers, pinned memory, AMP on CUDA.
6. **Reproducibility** — seeding when benchmarks or evaluations claim determinism.

## Evidence

- Quote the training/eval block, optimiser call, or DataLoader construction when flagging a defect.
- If behaviour depends on a particular accelerator (CUDA, MPS, XPU), call that out.

## British English

Use UK spelling in prose (*behaviour*, *optimisation*, *synchronisation*).

## When to stay quiet

- Hyperparameter choices without measured comparison.
- Model architecture taste (depth, width) absent clear defects.
- Third-party Trainer abstractions (Lightning, HF Trainer) that encapsulate these concerns correctly; confirm before flagging.

## Scoring

Hosts apply **`rubric.json` → `scoring`**: initial score **10**, subtract penalties, cap with **`max_total_penalty_per_file`**. Echo `rule.id` in findings.

## Shared rules: Explain Why (applies to every pack)

This pack inherits the **Explain Why (Critical)** and **Hidden side effects** rules from [../../AGENTS-SHARED.md](../../AGENTS-SHARED.md). Every finding at severity critical, error or warning must include a `why_it_matters` that teaches a concrete cost; any hidden side effect in the reviewed code must be named explicitly in the title or message. The MergeCore engine and extension audit this centrally, so this pack does not need to restate the bar — but authors editing the rubric should keep rule descriptions consistent with it.
