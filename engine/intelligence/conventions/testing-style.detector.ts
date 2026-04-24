import type { DetectorContext } from '../context';
import { addConvention, countFilesMatching, describeCount } from './helpers';

/**
 * Testing style — which framework and style the repo is using so the
 * reviewer can push back when a new test arrives in the wrong idiom
 * (e.g. a new PHPUnit class in a Pest-first codebase).
 *
 * Reads directly from the detector context flags set earlier by
 * path-signals and composer detectors, then confirms with content scans
 * so we don't surface "Uses Pest" based purely on a stray package entry.
 */
export async function detectTestingStyle(ctx: DetectorContext): Promise<void> {
  const testFiles = await ctx.listFiles(
    ['tests/', 'test/', '__tests__', 'spec/'],
    600
  );

  if (testFiles.length === 0) {
    return;
  }

  if (ctx.php.pest) {
    const pestFiles = await countFilesMatching(
      ctx,
      testFiles.filter((f) => f.endsWith('.php')),
      /^\s*(it|test|describe)\s*\(/m,
      60
    );
    if (pestFiles.matched >= 2) {
      addConvention(ctx, {
        id: 'testing:pest-first',
        label: 'Uses Pest for PHP tests (prefers it()/test()/describe() style)',
        confidence: pestFiles.matched >= 8 ? 'high' : 'medium',
        category: 'testing',
        evidence: [
          `${describeCount(pestFiles.matched, 'Pest-style test')} found (scan of ${pestFiles.scanned})`,
        ],
      });
    }
  }

  if (ctx.php.phpunit && !ctx.php.pest) {
    const phpunitFiles = await countFilesMatching(
      ctx,
      testFiles.filter((f) => f.endsWith('.php')),
      /class\s+\w+\s+extends\s+TestCase\b/,
      60
    );
    if (phpunitFiles.matched >= 2) {
      addConvention(ctx, {
        id: 'testing:phpunit-classes',
        label: 'Uses PHPUnit class-based tests (extends TestCase)',
        confidence: phpunitFiles.matched >= 8 ? 'high' : 'medium',
        category: 'testing',
        evidence: [
          `${describeCount(phpunitFiles.matched, 'PHPUnit test class')} found (scan of ${phpunitFiles.scanned})`,
        ],
      });
    }
  }

  // JS/TS testing idiom.
  const jsTests = testFiles.filter((f) => /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/.test(f));
  if (jsTests.length >= 2) {
    const vitestHits = await countFilesMatching(ctx, jsTests, /from\s+['"]vitest['"]|globals.*vitest/, 40);
    const jestHits = await countFilesMatching(ctx, jsTests, /\bjest\b|from\s+['"]@jest\//, 40);
    const nodeTestHits = await countFilesMatching(ctx, jsTests, /from\s+['"]node:test['"]/, 40);

    if (vitestHits.matched > Math.max(jestHits.matched, nodeTestHits.matched)) {
      addConvention(ctx, {
        id: 'testing:vitest',
        label: 'Uses Vitest for JS/TS tests',
        confidence: vitestHits.matched >= 6 ? 'high' : 'medium',
        category: 'testing',
        evidence: [`${describeCount(vitestHits.matched, 'Vitest file')} (scan of ${vitestHits.scanned})`],
      });
    } else if (jestHits.matched > Math.max(vitestHits.matched, nodeTestHits.matched)) {
      addConvention(ctx, {
        id: 'testing:jest',
        label: 'Uses Jest for JS/TS tests',
        confidence: jestHits.matched >= 6 ? 'high' : 'medium',
        category: 'testing',
        evidence: [`${describeCount(jestHits.matched, 'Jest file')} (scan of ${jestHits.scanned})`],
      });
    } else if (nodeTestHits.matched >= 2) {
      addConvention(ctx, {
        id: 'testing:node-test',
        label: 'Uses the built-in node:test runner',
        confidence: nodeTestHits.matched >= 6 ? 'high' : 'medium',
        category: 'testing',
        evidence: [
          `${describeCount(nodeTestHits.matched, 'node:test file')} (scan of ${nodeTestHits.scanned})`,
        ],
      });
    }
  }

  const pythonTests = testFiles.filter((f) => f.endsWith('.py') && /(test_|_test\.py$)/.test(f));
  if (pythonTests.length >= 2) {
    const pytestHits = await countFilesMatching(ctx, pythonTests, /\bimport pytest\b|@pytest\./, 40);
    if (pytestHits.matched >= 2) {
      addConvention(ctx, {
        id: 'testing:pytest',
        label: 'Uses pytest for Python tests',
        confidence: pytestHits.matched >= 6 ? 'high' : 'medium',
        category: 'testing',
        evidence: [`${describeCount(pytestHits.matched, 'pytest file')} (scan of ${pytestHits.scanned})`],
      });
    }
  }
}
