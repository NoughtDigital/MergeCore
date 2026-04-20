#!/usr/bin/env node
/**
 * Validates rule pack JSON files under `rules/packs/` against the schemas
 * published at `website/public/schemas/*.schema.json` (the same files that
 * are served from https://www.mergecore.dev/schemas/). A file is validated
 * if its top-level `$schema` matches the `$id` of a known schema. Files
 * without `$schema` (e.g. pack manifests, smell indexes) are skipped with a
 * note so we do not conflate "unrelated shape" with "invalid".
 *
 * Runs in CI and locally via `npm run validate:packs`.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import process from 'node:process';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const SCHEMAS_DIR = join(ROOT, 'website', 'public', 'schemas');
const PACKS_DIR = join(ROOT, 'rules', 'packs');

async function walk(dir) {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    const p = join(dir, entry);
    const s = await stat(p);
    if (s.isDirectory()) {
      files.push(...(await walk(p)));
    } else if (s.isFile() && extname(p) === '.json') {
      files.push(p);
    }
  }
  return files;
}

async function loadSchemas() {
  const candidates = (await readdir(SCHEMAS_DIR))
    .filter((f) => f.endsWith('.schema.json'))
    .map((f) => join(SCHEMAS_DIR, f));

  const byId = new Map();
  for (const file of candidates) {
    const body = JSON.parse(await readFile(file, 'utf8'));
    if (typeof body.$id === 'string') {
      byId.set(body.$id, body);
    }
  }
  return byId;
}

async function main() {
  const schemas = await loadSchemas();
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const schema of schemas.values()) {
    ajv.addSchema(schema);
  }

  let files;
  try {
    files = await walk(PACKS_DIR);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      console.log('No rules/packs directory; nothing to validate.');
      return;
    }
    throw e;
  }

  if (files.length === 0) {
    console.log('No rule pack JSON files found under rules/packs.');
    return;
  }

  let failures = 0;
  let validated = 0;
  let skipped = 0;
  for (const file of files) {
    const body = JSON.parse(await readFile(file, 'utf8'));
    const schemaId = typeof body.$schema === 'string' ? body.$schema : undefined;
    if (!schemaId) {
      console.log(`SKIP ${file} (no $schema)`);
      skipped++;
      continue;
    }
    const schema = schemas.get(schemaId);
    if (!schema) {
      console.log(`SKIP ${file} ($schema ${schemaId} not in website/public/schemas/)`);
      skipped++;
      continue;
    }
    const validate = ajv.getSchema(schemaId) ?? ajv.compile(schema);
    const ok = validate(body);
    if (ok) {
      console.log(`OK   ${file}`);
      validated++;
    } else {
      failures++;
      console.error(`FAIL ${file}`);
      for (const err of validate.errors ?? []) {
        console.error(`  ${err.instancePath || '/'} ${err.message}`);
      }
    }
  }

  console.log(`\nValidated ${validated} file(s); skipped ${skipped}; failed ${failures}.`);
  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
