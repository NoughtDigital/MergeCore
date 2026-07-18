import type { TaskContextMeta, TaskContextPack, TaskContextSection } from './task-context-types';
import { REQUIRED_TASK_CONTEXT_SECTIONS } from './task-context-types';

export function renderTaskContextMarkdown(
  meta: TaskContextMeta,
  sections: readonly TaskContextSection[],
  options: { readonly modelBanner?: boolean } = {}
): string {
  const lines: string[] = [];
  if (options.modelBanner) {
    lines.push(
      '> **Model transmission:** A local/provider model was used. Only retrieved evidence was sent. Citations not in that evidence set were discarded.'
    );
    lines.push('');
  } else {
    lines.push('> Deterministic task context — no model was used.');
    lines.push('');
  }

  for (const title of REQUIRED_TASK_CONTEXT_SECTIONS) {
    const section = sections.find((s) => s.title === title);
    lines.push(`# ${title}`);
    lines.push('');
    if (!section || section.bullets.length === 0) {
      lines.push('- _(none)_');
      lines.push('');
      continue;
    }
    for (const b of section.bullets) {
      if (b.startsWith('```') || b.startsWith('- ') || b.startsWith('**') || b.startsWith('>')) {
        lines.push(b);
      } else {
        lines.push(`- ${b}`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(
    meta.dataLeftMachine
      ? `_MergeCore task context · depth \`${meta.depth}\` · model \`${meta.modelProvider}\` · data left machine_`
      : `_MergeCore task context · depth \`${meta.depth}\` · deterministic · local only_`
  );
  return lines.join('\n');
}

export function packHasRequiredSections(markdown: string): boolean {
  return REQUIRED_TASK_CONTEXT_SECTIONS.every((h) => markdown.includes(`# ${h}`));
}

export function buildTaskContextPack(
  meta: TaskContextMeta,
  sections: readonly TaskContextSection[],
  options?: { readonly modelBanner?: boolean }
): TaskContextPack {
  return {
    meta,
    sections,
    markdown: renderTaskContextMarkdown(meta, sections, options),
    evidenceRefs: meta.sources,
  };
}
