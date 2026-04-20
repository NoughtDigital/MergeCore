#!/usr/bin/env node
/**
 * Rewires each rules pack so `pack.json#rubric_schema` and
 * `rubric.json#$schema` point at the pack's own hosted schema URL instead of
 * the shared `laravel-rules.schema.json`.
 *
 * Run: node scripts/rewire-pack-schemas.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const packsDir = resolve(repoRoot, "rules", "packs");

const SITE = "https://www.mergecore.dev";

// folder on disk -> schema slug hosted on the website
const mapping = {
  "laravel-core": "laravel",
  filament: "filament",
  livewire: "livewire",
  pest: "pest",
  alpine: "alpine",
  vue: "vue",
  react: "react",
  typescript: "typescript",
  python: "python",
  pytorch: "pytorch",
  go: "go",
  swift: "swift",
  swiftui: "swiftui",
  tauri: "tauri",
};

async function patchJson(file, patch) {
  const raw = await readFile(file, "utf8");
  const data = JSON.parse(raw);
  patch(data);
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function main() {
  for (const [folder, slug] of Object.entries(mapping)) {
    const url = `${SITE}/schemas/${slug}-rules.schema.json`;

    const packFile = resolve(packsDir, folder, "pack.json");
    await patchJson(packFile, (d) => {
      d.rubric_schema = url;
    });
    console.log(`pack.json  -> ${folder} :: ${url}`);

    const rubricFile = resolve(packsDir, folder, "rubric.json");
    await patchJson(rubricFile, (d) => {
      d.$schema = url;
    });
    console.log(`rubric.json-> ${folder} :: ${url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
