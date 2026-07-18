export {
  TypeScriptLanguageAdapter,
  JavaScriptLanguageAdapter,
  MarkdownLanguageAdapter,
  PhpLanguageAdapter,
  GenericLanguageAdapter,
  defaultLanguageAdapters,
  resolveLanguageAdapter,
  detectWorkspaceLanguages,
  collectAdapterEdges,
  stampAdapterId,
  type DefaultLanguageAdaptersOptions,
} from './language-adapters';

export {
  extractPhpSymbols,
  extractPhpDependencies,
  extractPhpTypeRelationships,
  extractPhpCallersOrReferences,
  extractPhpTestRelationships,
  extractPhpDiagnostics,
  collectPhpInvalidationTargets,
  detectPhpProject,
  resolvePhpFqcnToPath,
  loadComposerPsr4Map,
} from './php-extract';

export { linkCrossLanguageRouteEdges } from './cross-language-routes';

export { extractJsTsSymbols, extractJsTsDependencies } from './js-ts-extract';
