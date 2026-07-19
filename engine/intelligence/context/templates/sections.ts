import { SECTION_CATALOG, sectionTitle } from './section-catalog';
import type { ContextPackTemplate } from './types';
import type { TaskContextSection } from '../task-context-types';

export type SectionContentBag = Record<string, readonly string[]>;

/**
 * Build ordered pack sections from a template and content bags.
 * Missing bags yield a short uncertain/empty bullet so required headings exist.
 */
export function buildSectionsFromTemplate(
  template: ContextPackTemplate,
  bags: SectionContentBag
): TaskContextSection[] {
  return template.sections.map((id) => {
    const def = SECTION_CATALOG[id];
    const title = sectionTitle(id);
    const keys = def?.contentKeys ?? [id];
    const bullets: string[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
      for (const b of bags[key] ?? []) {
        if (seen.has(b)) continue;
        seen.add(b);
        bullets.push(b);
      }
    }
    if (bullets.length === 0) {
      return {
        title,
        bullets: [
          id === 'sources'
            ? '**Evidence:** No sources collected.'
            : `**Uncertain:** No evidence for section \`${id}\`.`,
        ],
      };
    }
    return { title, bullets };
  });
}

export function templateSectionTitles(
  template: ContextPackTemplate
): readonly string[] {
  return template.sections.map(sectionTitle);
}

export function packMatchesTemplateSections(
  markdown: string,
  template: ContextPackTemplate
): boolean {
  return templateSectionTitles(template).every((h) => markdown.includes(`# ${h}`));
}
