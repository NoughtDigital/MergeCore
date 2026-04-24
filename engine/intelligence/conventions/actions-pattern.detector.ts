import type { DetectorContext } from '../context';
import { addConvention, countFilesMatching, countPathMatches, describeCount, tierByCount } from './helpers';

/**
 * Actions pattern — invokable single-responsibility classes, usually named
 * `*Action.php` / `*Action.ts` and containing a `handle`/`execute`/`__invoke`
 * entrypoint. Framework-agnostic: works for Laravel actions, Hexagonal use
 * cases, service-action style in TS/Node, Django services, etc.
 */
export async function detectActionsPattern(ctx: DetectorContext): Promise<void> {
  const candidates = await ctx.listFiles(
    ['/actions/', '/action/'],
    400
  );
  const namedActions = candidates.filter((rel) => /action(\.[a-z]+)?$|action\.[a-z]+$/i.test(rel));

  const byPath = namedActions.length > 0 ? namedActions : candidates;
  if (byPath.length === 0) {
    return;
  }

  const invoker = /function\s+(handle|execute|__invoke)\s*\(|\bpublic\s+(function|async)\s+(handle|execute|__invoke)\b|\bexport\s+(default\s+)?(async\s+)?function\s+[A-Za-z_]+\s*\(/;
  const { matched, scanned } = await countFilesMatching(ctx, byPath, invoker, 30);

  const confidence = tierByCount(byPath.length, 4, 2);
  if (!confidence) {
    return;
  }

  const invokerRatio = scanned > 0 ? matched / scanned : 0;
  const finalConfidence = invokerRatio >= 0.5 || confidence === 'high' ? confidence : 'low';

  addConvention(ctx, {
    id: 'arch:actions-pattern',
    label: 'Uses Actions pattern (single-responsibility invokable classes)',
    confidence: finalConfidence,
    category: 'architecture',
    evidence: [
      `${describeCount(byPath.length, 'action file')} under Actions/ directory`,
      scanned > 0
        ? `${matched}/${scanned} scanned expose a handle/execute/__invoke entrypoint`
        : 'no content scan performed',
    ],
  });
}

/**
 * Commands pattern — explicit CQRS-style commands with handlers. Detected
 * from conventional folder names used across PHP (Laravel), Symfony,
 * NestJS, .NET-inspired TS codebases, and Go. Works alongside actions —
 * we emit a separate convention so reviews can critique both where they
 * overlap (e.g. a new "Action" in a "Commands/" codebase is inconsistent).
 */
export async function detectCommandsPattern(ctx: DetectorContext): Promise<void> {
  const commands = await countPathMatches(ctx, ['/commands/']);
  const handlers = await countPathMatches(ctx, ['/handlers/']);

  const confidence = tierByCount(Math.min(commands, Math.max(handlers, 1)), 4, 2);
  if (!confidence) {
    return;
  }

  addConvention(ctx, {
    id: 'arch:commands-and-handlers',
    label: 'Uses Commands + Handlers pattern',
    confidence,
    category: 'architecture',
    evidence: [
      `${describeCount(commands, 'command file')} in Commands/`,
      `${describeCount(handlers, 'handler file')} in Handlers/`,
    ],
  });
}
