---
name: mergecore
description: >-
  Use MergeCore local cognition (MCP) for repository questions, architecture
  context, pack guidance, and production-risk scans instead of inventing
  structure. Apply when the user asks about how a MergeCore-indexed codebase
  works, which packs apply, what breaks in production, or when MergeCore MCP
  tools are available.
---

# MergeCore

MergeCore is local-first repository cognition. Prefer its tools over guessing architecture from a partial file list.

## When to use

- Explaining how this repo is structured or how a symbol fits the system
- Choosing or reading rules packs (`agents.md`, rubrics)
- Scanning for production risks before merge
- Onboarding into a Laravel/PHP (or pack-covered) workspace

## Required MCP tools

Call MergeCore MCP tools when configured. Do not invent pack rules or architecture that the index already holds.

| Tool | Use for |
|------|---------|
| `mergecore_workspace_profile` | Stack signals and conventions |
| `mergecore_index_status` | Whether `.mergecore/rag/` is ready |
| `mergecore_index` | Build/refresh the local index (only if status is empty or stale) |
| `mergecore_retrieve` | Repo memory and code chunks for a question |
| `mergecore_explain_context` | RAG context for a symbol / file |
| `mergecore_list_packs` | Registered packs |
| `mergecore_read_pack_guidance` | Pack `agents.md` / manifest |
| `mergecore_scan_prod_risks` | Pack-aware production-risk findings |

## Behaviour

1. Set or respect `MERGECORE_WORKSPACE` as the project root.
2. If the index is empty, run `mergecore_index` once before heavy retrieve calls.
3. Answer from retrieved evidence and pack guidance; cite paths from hits.
4. Prefer pack rubrics over generic style advice.
5. Keep user-facing language in UK English.
6. Do not ship source to remote APIs when local tools suffice.
7. The VS Code / Cursor extension owns hover UI; agents use MCP, not a second plugin.

## Skill vs MCP

This skill is bootstrap only. Cognition comes from the MCP server and local RAG — not from this file alone.
