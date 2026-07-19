export type {
  TaskContextDepth,
  TaskContextSourceRef,
  TaskContextSection,
  TaskContextMeta,
  TaskContextPack,
  TaskContextInput,
} from './task-context-types';

export {
  TASK_CONTEXT_SCHEMA_VERSION,
  REQUIRED_TASK_CONTEXT_SECTIONS,
} from './task-context-types';

export { budgetsForDepth, parseTaskContextDepth } from './task-context-budgets';
export { assembleTaskContextPack } from './task-context-assemble';
export {
  renderTaskContextMarkdown,
  packHasRequiredSections,
  buildTaskContextPack,
} from './task-context-markdown';
export {
  metaToFrontmatter,
  serialiseTaskContextDocument,
  parseTaskContextFrontmatter,
  slugifyTask,
  compactTimestamp,
  type TaskContextFrontmatter,
} from './task-context-frontmatter';
export {
  writeTaskContextPack,
  type WriteTaskContextPackResult,
} from './write-task-context-pack';
export { detectTaskRiskIndicators, type TaskRiskIndicator } from './task-risks';

export {
  listBuiltinTemplates,
  getBuiltinTemplate,
  listContextPackTemplates,
  resolveContextPackTemplate,
  customiseTemplate,
  previewContextPackTemplate,
  saveContextPackTemplate,
  setWorkspaceDefaultTemplate,
  readWorkspaceDefaultTemplateId,
  parseContextPackTemplateMarkdown,
  serialiseContextPackTemplate,
  inheritBuiltinDefaults,
  budgetsFromTemplate,
  packMatchesTemplateSections,
  TEMPLATE_BUDGET_CEILING,
  TEMPLATE_FORBIDDEN_KEYS,
  BUILTIN_TEMPLATES,
  SECTION_CATALOG,
  type ContextPackTemplate,
  type TemplatePreview,
  type TemplateCustomiseInput,
  type TemplateParseIssue,
  type TemplateParseResult,
  type LoadedTemplates,
} from './templates';
