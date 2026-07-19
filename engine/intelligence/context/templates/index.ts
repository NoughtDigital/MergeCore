export type {
  ContextPackTemplate,
  TemplateSourceType,
  TemplatePrioritiseHint,
  TemplateRetrievalSettings,
  TemplateParseIssue,
  TemplateParseResult,
  TemplatePreview,
  TemplateCustomiseInput,
  ResolveTemplatesOptions,
} from './types';

export {
  TEMPLATE_BUDGET_CEILING,
  TEMPLATE_FORBIDDEN_KEYS,
} from './types';

export {
  SECTION_CATALOG,
  CORE_SECTION_IDS,
  sectionTitle,
  isKnownSectionId,
} from './section-catalog';

export {
  BUILTIN_TEMPLATES,
  getBuiltinTemplate,
  listBuiltinTemplates,
  slugifyName,
} from './builtins';

export {
  parseContextPackTemplateMarkdown,
  serialiseContextPackTemplate,
  inheritBuiltinDefaults,
  parseSimpleYaml,
} from './parse';

export {
  listContextPackTemplates,
  resolveContextPackTemplate,
  customiseTemplate,
  previewContextPackTemplate,
  saveContextPackTemplate,
  setWorkspaceDefaultTemplate,
  readWorkspaceDefaultTemplateId,
  budgetsFromTemplate,
  type LoadedTemplates,
} from './resolve';

export {
  buildSectionsFromTemplate,
  templateSectionTitles,
  packMatchesTemplateSections,
  type SectionContentBag,
} from './sections';
