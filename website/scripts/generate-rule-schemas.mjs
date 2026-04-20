#!/usr/bin/env node
/**
 * Generates per-pack rubric JSON Schemas under website/public/schemas.
 *
 * All packs share the same rubric shape. The only thing that varies is the
 * schema $id, title, and (for PHP / Laravel-ecosystem packs) a few extra
 * optional gate booleans on rule items.
 *
 * Run: node website/scripts/generate-rule-schemas.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "public", "schemas");

const SITE = "https://www.mergecore.dev";

// slug -> human title shown in the schema
const packs = [
  { slug: "laravel", title: "MergeCore Laravel rules pack", phpGates: true },
  { slug: "filament", title: "MergeCore Filament rules pack", phpGates: true },
  { slug: "livewire", title: "MergeCore Livewire rules pack", phpGates: true },
  { slug: "pest", title: "MergeCore Pest rules pack", phpGates: true },
  { slug: "alpine", title: "MergeCore Alpine.js rules pack" },
  { slug: "vue", title: "MergeCore Vue rules pack" },
  { slug: "react", title: "MergeCore React rules pack" },
  { slug: "typescript", title: "MergeCore TypeScript rules pack" },
  { slug: "python", title: "MergeCore Python rules pack" },
  { slug: "pytorch", title: "MergeCore PyTorch rules pack" },
  { slug: "go", title: "MergeCore Go rules pack" },
  { slug: "swift", title: "MergeCore Swift rules pack" },
  { slug: "swiftui", title: "MergeCore SwiftUI rules pack" },
  { slug: "tauri", title: "MergeCore Tauri rules pack" },
];

function buildSchema({ slug, title, phpGates }) {
  const ruleProps = {
    id: { type: "string", pattern: "^[A-Z0-9\\-]+$" },
    category: { type: "string" },
    severity: { type: "string" },
    quality_signal: {
      type: "string",
      enum: ["junior", "risky", "overengineered", "senior_positive"],
    },
    title: { type: "string" },
    description: { type: "string" },
    penalty: {
      type: "number",
      description:
        "Score delta applied when the rule fires. Negative values are bonuses (typically paired with quality_signal=senior_positive).",
    },
    detection: { type: "object" },
    examples: { type: "object" },
  };

  if (phpGates) {
    ruleProps.filament = { type: "boolean" };
    ruleProps.pest = { type: "boolean" };
    ruleProps.tenancy = { type: "boolean" };
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${SITE}/schemas/${slug}-rules.schema.json`,
    title,
    type: "object",
    required: ["meta", "severity_levels", "scoring", "rules"],
    properties: {
      meta: {
        type: "object",
        required: ["pack_version", "locale"],
        properties: {
          pack_id: { type: "string" },
          pack_version: { type: "string" },
          locale: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          notes: { type: "string" },
        },
      },
      severity_levels: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: {
            rank: { type: "integer", minimum: 0 },
            label: { type: "string" },
            default_penalty: { type: "number", minimum: 0 },
          },
        },
      },
      scoring: { type: "object" },
      rules: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "category", "severity", "quality_signal", "title"],
          properties: ruleProps,
        },
      },
    },
  };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const pack of packs) {
    const file = resolve(outDir, `${pack.slug}-rules.schema.json`);
    const json = JSON.stringify(buildSchema(pack), null, 2) + "\n";
    await writeFile(file, json, "utf8");
    console.log(`wrote ${file}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
