import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  conventionStrength,
  resolveConventionConflicts,
  type ConventionLike,
} from '../../conventions/resolve-conflicts';

function conv(
  partial: Partial<ConventionLike> & Pick<ConventionLike, 'id' | 'label'>
): ConventionLike {
  return {
    confidence: 'medium',
    category: 'architecture',
    ...partial,
  };
}

test('Services dominate → suppress Actions', () => {
  const resolved = resolveConventionConflicts([
    conv({
      id: 'layering:services-over-helpers',
      label: 'Prefers services',
      confidence: 'high',
      category: 'layering',
      evidence: ['24 service files in Services/', '2 files in Helpers/'],
    }),
    conv({
      id: 'arch:actions-pattern',
      label: 'Uses Actions',
      confidence: 'medium',
      category: 'architecture',
      evidence: ['3 action files under Actions/'],
    }),
    conv({
      id: 'testing:pest-first',
      label: 'Pest-first',
      confidence: 'high',
      category: 'testing',
      evidence: ['12 pest tests'],
    }),
  ]);

  assert.equal(resolved.dominantLayeringId, 'layering:services-over-helpers');
  assert.ok(resolved.activeConventions.some((c) => c.id === 'layering:services-over-helpers'));
  assert.ok(resolved.activeConventions.some((c) => c.id === 'testing:pest-first'));
  assert.ok(!resolved.activeConventions.some((c) => c.id === 'arch:actions-pattern'));
  assert.equal(resolved.suppressedConventions.length, 1);
  assert.equal(resolved.suppressedConventions[0].convention.id, 'arch:actions-pattern');
  assert.match(resolved.suppressedConventions[0].reason, /outvoted by layering:services-over-helpers/);
});

test('Actions dominate → keep Actions, suppress Services', () => {
  const resolved = resolveConventionConflicts([
    conv({
      id: 'arch:actions-pattern',
      label: 'Uses Actions',
      confidence: 'high',
      evidence: ['18 action files under Actions/'],
    }),
    conv({
      id: 'layering:services-over-helpers',
      label: 'Prefers services',
      confidence: 'low',
      category: 'layering',
      evidence: ['2 service files in Services/'],
    }),
  ]);

  assert.equal(resolved.dominantLayeringId, 'arch:actions-pattern');
  assert.ok(resolved.activeConventions.some((c) => c.id === 'arch:actions-pattern'));
  assert.ok(!resolved.activeConventions.some((c) => c.id === 'layering:services-over-helpers'));
  assert.equal(resolved.suppressedConventions[0].dominatedBy, 'arch:actions-pattern');
});

test('both medium and close scores → keep both active', () => {
  const resolved = resolveConventionConflicts([
    conv({
      id: 'arch:actions-pattern',
      label: 'Uses Actions',
      confidence: 'medium',
      evidence: ['10 action files under Actions/'],
    }),
    conv({
      id: 'layering:services-over-helpers',
      label: 'Prefers services',
      confidence: 'medium',
      category: 'layering',
      evidence: ['9 service files in Services/'],
    }),
  ]);

  const ids = resolved.activeConventions.map((c) => c.id).sort();
  assert.deepEqual(ids, ['arch:actions-pattern', 'layering:services-over-helpers']);
  assert.equal(resolved.suppressedConventions.length, 0);
  assert.equal(resolved.dominantLayeringId, 'arch:actions-pattern');
});

test('conventionStrength prefers parsed file counts', () => {
  const strong = conv({
    id: 'layering:services-over-helpers',
    label: 's',
    confidence: 'high',
    evidence: ['24 service files'],
  });
  const weak = conv({
    id: 'arch:actions-pattern',
    label: 'a',
    confidence: 'high',
    evidence: ['3 action files'],
  });
  assert.ok(conventionStrength(strong) > conventionStrength(weak));
});

test('non-rival conventions pass through unchanged', () => {
  const resolved = resolveConventionConflicts([
    conv({ id: 'testing:pest-first', label: 'Pest', category: 'testing' }),
    conv({ id: 'types:typescript-strict', label: 'Strict', category: 'types' }),
  ]);
  assert.equal(resolved.activeConventions.length, 2);
  assert.equal(resolved.suppressedConventions.length, 0);
  assert.equal(resolved.dominantLayeringId, undefined);
});
