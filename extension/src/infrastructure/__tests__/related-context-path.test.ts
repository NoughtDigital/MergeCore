import { strict as assert } from 'node:assert';
import * as path from 'node:path';
import { test } from 'node:test';
import { resolveInsideWorkspace } from '../workspace-path';

test('resolveInsideWorkspace accepts paths under the workspace root', () => {
  const root = path.resolve('/tmp/mergecore-ws');
  const resolved = resolveInsideWorkspace(root, 'app/Models/User.php');
  assert.equal(resolved, path.join(root, 'app/Models/User.php'));
});

test('resolveInsideWorkspace rejects path traversal outside the workspace', () => {
  const root = path.resolve('/tmp/mergecore-ws');
  assert.equal(resolveInsideWorkspace(root, '../../../etc/passwd'), undefined);
  assert.equal(resolveInsideWorkspace(root, 'app/../../outside/secret.env'), undefined);
});

test('resolveInsideWorkspace rejects empty relative paths', () => {
  const root = path.resolve('/tmp/mergecore-ws');
  assert.equal(resolveInsideWorkspace(root, ''), undefined);
});
