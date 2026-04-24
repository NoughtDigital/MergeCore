import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectProjectProfile } from '../../../../engine/intelligence/collect';

/**
 * Spin up a temp workspace, populate it with a minimal file layout, and
 * run the full `collectProjectProfile` pipeline. Keeps the tests close to
 * the real extension code path without mocking the filesystem layer.
 */
async function withWorkspace<T>(
  build: (root: string) => Promise<void>,
  fn: (root: string) => Promise<T>
): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-conv-'));
  try {
    await build(root);
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeFile(root: string, rel: string, contents: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents, 'utf8');
}

test('detects Actions pattern when Actions/ files expose handle/execute/__invoke', async () => {
  await withWorkspace(
    async (root) => {
      await writeFile(root, 'composer.json', JSON.stringify({ require: { 'laravel/framework': '^10' } }));
      await writeFile(
        root,
        'app/Actions/CreateUserAction.php',
        '<?php class CreateUserAction { public function handle($user) { return $user; } }'
      );
      await writeFile(
        root,
        'app/Actions/SendInvoiceAction.php',
        '<?php class SendInvoiceAction { public function __invoke($invoice) { return true; } }'
      );
      await writeFile(
        root,
        'app/Actions/ArchiveOrderAction.php',
        '<?php class ArchiveOrderAction { public function execute($order) {} }'
      );
      await writeFile(
        root,
        'app/Actions/DeleteUserAction.php',
        '<?php class DeleteUserAction { public function handle($user) {} }'
      );
    },
    async (root) => {
      const profile = await collectProjectProfile(root);
      const ids = profile.conventions.map((c) => c.id);
      assert.ok(ids.includes('arch:actions-pattern'), `expected arch:actions-pattern in ${ids.join(',')}`);
      assert.ok(profile.signals.includes('convention:arch:actions-pattern'));
    }
  );
});

test('detects Pest-first testing style and exposes it as a convention', async () => {
  await withWorkspace(
    async (root) => {
      await writeFile(
        root,
        'composer.json',
        JSON.stringify({ 'require-dev': { 'pestphp/pest': '^2' } })
      );
      await writeFile(root, 'pest.php', '<?php');
      for (let i = 0; i < 5; i += 1) {
        await writeFile(
          root,
          `tests/Feature/Thing${i}Test.php`,
          "<?php\n\nit('does the thing', function () {\n    expect(true)->toBeTrue();\n});\n"
        );
      }
    },
    async (root) => {
      const profile = await collectProjectProfile(root);
      const pest = profile.conventions.find((c) => c.id === 'testing:pest-first');
      assert.ok(pest, `expected Pest convention, got ${JSON.stringify(profile.conventions)}`);
      assert.equal(pest?.category, 'testing');
    }
  );
});

test('detects DTOs when /Data/ classes exist', async () => {
  await withWorkspace(
    async (root) => {
      await writeFile(root, 'composer.json', JSON.stringify({ require: {} }));
      await writeFile(root, 'app/Data/UserData.php', '<?php class UserData {}');
      await writeFile(root, 'app/Data/OrderData.php', '<?php class OrderData {}');
      await writeFile(root, 'app/Data/InvoiceData.php', '<?php class InvoiceData {}');
    },
    async (root) => {
      const profile = await collectProjectProfile(root);
      const dto = profile.conventions.find((c) => c.id === 'data:dtos');
      assert.ok(dto, `expected DTO convention, got ${profile.conventions.map((c) => c.id).join(',')}`);
    }
  );
});

test('detects services-over-helpers when Services/ dominates Helpers/', async () => {
  await withWorkspace(
    async (root) => {
      await writeFile(root, 'composer.json', JSON.stringify({ require: {} }));
      for (let i = 0; i < 6; i += 1) {
        await writeFile(root, `app/Services/Service${i}.php`, `<?php class Service${i} {}`);
      }
      await writeFile(root, 'app/Helpers/misc.php', '<?php');
    },
    async (root) => {
      const profile = await collectProjectProfile(root);
      const svc = profile.conventions.find((c) => c.id === 'layering:services-over-helpers');
      assert.ok(svc, `expected services convention, got ${profile.conventions.map((c) => c.id).join(',')}`);
    }
  );
});

test('detects strict TypeScript as a types convention', async () => {
  await withWorkspace(
    async (root) => {
      await writeFile(
        root,
        'package.json',
        JSON.stringify({ devDependencies: { typescript: '^5' } })
      );
      await writeFile(
        root,
        'tsconfig.json',
        JSON.stringify({ compilerOptions: { strict: true, noUncheckedIndexedAccess: true } })
      );
    },
    async (root) => {
      const profile = await collectProjectProfile(root);
      const strict = profile.conventions.find((c) => c.id === 'types:typescript-strict');
      assert.ok(strict);
      assert.equal(strict?.confidence, 'high');
    }
  );
});

test('team-declared conventions via .mergecore/conventions.json are respected', async () => {
  await withWorkspace(
    async (root) => {
      await writeFile(root, 'package.json', JSON.stringify({}));
      await writeFile(
        root,
        '.mergecore/conventions.json',
        JSON.stringify({
          conventions: [
            {
              id: 'ui:no-tailwind-arbitrary-values',
              label: 'Avoid arbitrary Tailwind values; extend theme instead',
              confidence: 'high',
              category: 'ui',
            },
            { id: 'api:cursor-pagination', label: 'All list endpoints use cursor pagination' },
          ],
        })
      );
    },
    async (root) => {
      const profile = await collectProjectProfile(root);
      const ids = profile.conventions.map((c) => c.id);
      assert.ok(ids.includes('ui:no-tailwind-arbitrary-values'));
      assert.ok(ids.includes('api:cursor-pagination'));
      const cursor = profile.conventions.find((c) => c.id === 'api:cursor-pagination');
      assert.equal(cursor?.confidence, 'high', 'missing confidence defaults to high');
      assert.equal(cursor?.category, 'other', 'missing category defaults to other');
    }
  );
});

test('declared conventions override built-in detector confidence on id collision', async () => {
  await withWorkspace(
    async (root) => {
      await writeFile(root, 'composer.json', JSON.stringify({ require: {} }));
      await writeFile(root, 'app/Services/A.php', '<?php class A {}');
      await writeFile(root, 'app/Services/B.php', '<?php class B {}');
      await writeFile(root, 'app/Services/C.php', '<?php class C {}');
      await writeFile(root, 'app/Services/D.php', '<?php class D {}');
      await writeFile(root, 'app/Services/E.php', '<?php class E {}');
      await writeFile(
        root,
        'mergecore.conventions.json',
        JSON.stringify({
          conventions: [
            {
              id: 'layering:services-over-helpers',
              label: 'Repo-wide: every cross-cutting concern is a Service',
              confidence: 'high',
              category: 'layering',
            },
          ],
        })
      );
    },
    async (root) => {
      const profile = await collectProjectProfile(root);
      const svc = profile.conventions.find((c) => c.id === 'layering:services-over-helpers');
      assert.ok(svc);
      assert.equal(svc?.label, 'Repo-wide: every cross-cutting concern is a Service');
      assert.equal(svc?.confidence, 'high');
    }
  );
});

test('empty workspaces produce an empty conventions list without throwing', async () => {
  await withWorkspace(
    async () => {},
    async (root) => {
      const profile = await collectProjectProfile(root);
      assert.deepEqual(profile.conventions, []);
      assert.equal(profile.fingerprint, 'generic');
    }
  );
});
