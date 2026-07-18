import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(__filename);
const fixtures = require('../../../packages/test-fixtures/index.js') as {
  typescriptMiniRoot: string;
  javascriptMiniRoot: string;
  typescriptGraphRoot: string;
};

describe('package boundaries', () => {
  it('core package source does not import vscode', () => {
    const root = path.join(__dirname, '..');
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') {
          continue;
        }
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(abs);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.js')) {
          continue;
        }
        const text = fs.readFileSync(abs, 'utf8');
        if (
          /\bfrom\s+['"]vscode['"]/.test(text) ||
          /\brequire\s*\(\s*['"]vscode['"]\s*\)/.test(text)
        ) {
          offenders.push(path.relative(root, abs));
        }
      }
    }

    walk(root);
    assert.deepEqual(offenders, []);
  });

  it('compiled dist does not reference vscode', () => {
    const distIndex = path.join(__dirname, '..', 'dist', 'index.js');
    assert.ok(fs.existsSync(distIndex), 'dist/index.js must exist (run build first)');
    const text = fs.readFileSync(distIndex, 'utf8');
    assert.equal(text.includes("require(\"vscode\")"), false);
    assert.equal(text.includes("from 'vscode'"), false);
  });

  it('does not create circular package dependencies', () => {
    const intelligencePkg = require('../package.json') as {
      name: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const deps = {
      ...(intelligencePkg.dependencies ?? {}),
      ...(intelligencePkg.peerDependencies ?? {}),
    };
    assert.equal(deps['mergecore'], undefined);
    assert.equal(deps['@mergecore/mcp'], undefined);
    assert.equal(deps['vscode'], undefined);
    assert.equal(deps['@types/vscode'], undefined);

    // Extension and MCP may depend on intelligence, not the reverse
    const extensionPkgPath = path.join(__dirname, '..', '..', '..', 'extension', 'package.json');
    const mcpPkgPath = path.join(__dirname, '..', '..', '..', 'mcp', 'package.json');
    const extensionPkg = JSON.parse(fs.readFileSync(extensionPkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const mcpPkg = JSON.parse(fs.readFileSync(mcpPkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    assert.ok(extensionPkg.dependencies?.['@mergecore/intelligence']);
    assert.ok(mcpPkg.dependencies?.['@mergecore/intelligence']);
  });

  it('exposes fixture roots for tests', () => {
    assert.ok(fs.existsSync(fixtures.typescriptMiniRoot));
    assert.ok(fs.existsSync(fixtures.javascriptMiniRoot));
    assert.ok(fs.existsSync(fixtures.typescriptGraphRoot));
    assert.ok(fs.existsSync(path.join(fixtures.typescriptMiniRoot, 'src', 'index.ts')));
    assert.ok(fs.existsSync(path.join(fixtures.javascriptMiniRoot, 'src', 'index.js')));
    assert.ok(fs.existsSync(path.join(fixtures.typescriptGraphRoot, 'src', 'core.ts')));
  });
});
