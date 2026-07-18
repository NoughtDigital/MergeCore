import type {
  ContextClaim,
  ContextPack,
  ContextResult,
  DependencyEdge,
  DocumentChunk,
  FileFingerprint,
  FileRecord,
  IndexStatus,
  InstructionDocument,
  InstructionRule,
  SourceReference,
  SymbolLocation,
  SymbolRecord,
  WorkspaceDescriptor,
} from './types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') {
    throw new Error(`Expected string field "${key}"`);
  }
  return v;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new Error(`Expected number field "${key}"`);
  }
  return v;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function optionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
}

function optionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function serializeWorkspaceDescriptor(value: WorkspaceDescriptor): string {
  return JSON.stringify(value);
}

export function parseWorkspaceDescriptor(json: string): WorkspaceDescriptor {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('WorkspaceDescriptor must be an object');
  }
  const languages = raw.languages;
  if (!Array.isArray(languages) || !languages.every((l) => typeof l === 'string')) {
    throw new Error('WorkspaceDescriptor.languages must be string[]');
  }
  return {
    rootPath: requireString(raw, 'rootPath'),
    displayName: requireString(raw, 'displayName'),
    fingerprint: requireString(raw, 'fingerprint'),
    indexedAt: optionalNumber(raw, 'indexedAt'),
    languages,
  };
}

export function serializeFileFingerprint(value: FileFingerprint): string {
  return JSON.stringify(value);
}

export function parseFileFingerprint(json: string): FileFingerprint {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('FileFingerprint must be an object');
  }
  return {
    path: requireString(raw, 'path'),
    contentHash: requireString(raw, 'contentHash'),
    mtimeMs: requireNumber(raw, 'mtimeMs'),
    byteLength: optionalNumber(raw, 'byteLength'),
  };
}

export function serializeFileRecord(value: FileRecord): string {
  return JSON.stringify(value);
}

export function parseFileRecord(json: string): FileRecord {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('FileRecord must be an object');
  }
  const fingerprint = raw.fingerprint;
  if (!isObject(fingerprint)) {
    throw new Error('FileRecord.fingerprint must be an object');
  }
  const chunkIds = raw.chunkIds;
  if (!Array.isArray(chunkIds) || !chunkIds.every((c) => typeof c === 'string')) {
    throw new Error('FileRecord.chunkIds must be string[]');
  }
  const symbolIds = raw.symbolIds;
  if (
    symbolIds !== undefined &&
    (!Array.isArray(symbolIds) || !symbolIds.every((c) => typeof c === 'string'))
  ) {
    throw new Error('FileRecord.symbolIds must be string[] when present');
  }
  const parseStatus = requireString(raw, 'parseStatus');
  if (
    parseStatus !== 'ok' &&
    parseStatus !== 'skipped' &&
    parseStatus !== 'error' &&
    parseStatus !== 'unchanged'
  ) {
    throw new Error(`Invalid FileRecord.parseStatus: ${parseStatus}`);
  }
  const result: FileRecord = {
    workspaceId: requireString(raw, 'workspaceId'),
    path: requireString(raw, 'path'),
    fingerprint: {
      path: requireString(fingerprint, 'path'),
      contentHash: requireString(fingerprint, 'contentHash'),
      mtimeMs: requireNumber(fingerprint, 'mtimeMs'),
    },
    language: requireString(raw, 'language'),
    byteLength: requireNumber(raw, 'byteLength'),
    mtimeMs: requireNumber(raw, 'mtimeMs'),
    contentHash: requireString(raw, 'contentHash'),
    indexedAt: requireNumber(raw, 'indexedAt'),
    parseStatus,
    chunkIds,
  };
  const fpByte = optionalNumber(fingerprint, 'byteLength');
  if (fpByte !== undefined) {
    (result.fingerprint as { byteLength?: number }).byteLength = fpByte;
  }
  if (symbolIds !== undefined) {
    (result as { symbolIds?: string[] }).symbolIds = symbolIds as string[];
  }
  return result;
}

export function serializeSymbolLocation(value: SymbolLocation): string {
  return JSON.stringify(value);
}

export function parseSymbolLocation(json: string): SymbolLocation {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('SymbolLocation must be an object');
  }
  const result: SymbolLocation = {
    path: requireString(raw, 'path'),
    startLine: requireNumber(raw, 'startLine'),
    endLine: requireNumber(raw, 'endLine'),
  };
  const startColumn = optionalNumber(raw, 'startColumn');
  const endColumn = optionalNumber(raw, 'endColumn');
  if (startColumn !== undefined) {
    (result as { startColumn?: number }).startColumn = startColumn;
  }
  if (endColumn !== undefined) {
    (result as { endColumn?: number }).endColumn = endColumn;
  }
  return result;
}

export function serializeSymbolRecord(value: SymbolRecord): string {
  return JSON.stringify(value);
}

export function parseSymbolRecord(json: string): SymbolRecord {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('SymbolRecord must be an object');
  }
  const location = raw.location;
  if (!isObject(location)) {
    throw new Error('SymbolRecord.location must be an object');
  }
  const language = requireString(raw, 'language');
  const adapterId = optionalString(raw, 'adapterId') ?? language;
  const result: SymbolRecord = {
    id: requireString(raw, 'id'),
    name: requireString(raw, 'name'),
    kind: requireString(raw, 'kind'),
    location: parseSymbolLocation(JSON.stringify(location)),
    language,
    adapterId,
  };
  const exported = optionalBoolean(raw, 'exported');
  const containerName = optionalString(raw, 'containerName');
  if (exported !== undefined) {
    (result as { exported?: boolean }).exported = exported;
  }
  if (containerName !== undefined) {
    (result as { containerName?: string }).containerName = containerName;
  }
  const returnTypeText = optionalString(raw, 'returnTypeText');
  const jsdocSummary = optionalString(raw, 'jsdocSummary');
  const signatureText = optionalString(raw, 'signatureText');
  const overloadIndex = optionalNumber(raw, 'overloadIndex');
  if (returnTypeText !== undefined) {
    (result as { returnTypeText?: string }).returnTypeText = returnTypeText;
  }
  if (jsdocSummary !== undefined) {
    (result as { jsdocSummary?: string }).jsdocSummary = jsdocSummary;
  }
  if (signatureText !== undefined) {
    (result as { signatureText?: string }).signatureText = signatureText;
  }
  if (overloadIndex !== undefined) {
    (result as { overloadIndex?: number }).overloadIndex = overloadIndex;
  }
  const parameters = raw.parameters;
  if (parameters !== undefined) {
    if (!Array.isArray(parameters)) {
      throw new Error('SymbolRecord.parameters must be an array when present');
    }
    (result as { parameters?: SymbolRecord['parameters'] }).parameters = parameters.map((p) => {
      if (!isObject(p)) {
        throw new Error('SymbolParameter must be an object');
      }
      const param: {
        name: string;
        typeText?: string;
        optional?: boolean;
        rest?: boolean;
      } = { name: requireString(p, 'name') };
      const typeText = optionalString(p, 'typeText');
      const optional = optionalBoolean(p, 'optional');
      const rest = optionalBoolean(p, 'rest');
      if (typeText !== undefined) {
        param.typeText = typeText;
      }
      if (optional !== undefined) {
        param.optional = optional;
      }
      if (rest !== undefined) {
        param.rest = rest;
      }
      return param;
    });
  }
  return result;
}

export function serializeDependencyEdge(value: DependencyEdge): string {
  return JSON.stringify(value);
}

const EDGE_KINDS = new Set([
  'import',
  'require',
  'export',
  'reference',
  'call',
  'extends',
  'implements',
  'typeUsage',
  'fileDependency',
  'likelyTestCoverage',
]);

const EDGE_CONFIDENCE = new Set(['certain', 'high', 'medium', 'low', 'heuristic']);

const EDGE_RESOLUTION = new Set([
  'compiler',
  'ast',
  'convention',
  'typescript-checker',
  'typescript-ast',
  'path-alias',
  'naming-heuristic',
  'import-graph',
  'unresolved',
  'heuristic',
]);

export function parseDependencyEdge(json: string): DependencyEdge {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('DependencyEdge must be an object');
  }
  const kind = requireString(raw, 'kind');
  if (!EDGE_KINDS.has(kind)) {
    throw new Error(`Invalid DependencyEdge.kind: ${kind}`);
  }
  const result: DependencyEdge = {
    id: requireString(raw, 'id'),
    fromPath: requireString(raw, 'fromPath'),
    toPath: requireString(raw, 'toPath'),
    kind: kind as DependencyEdge['kind'],
    specifier: requireString(raw, 'specifier'),
    fromSymbol: optionalString(raw, 'fromSymbol'),
    toSymbol: optionalString(raw, 'toSymbol'),
    startLine: optionalNumber(raw, 'startLine'),
  };
  const startColumn = optionalNumber(raw, 'startColumn');
  const endLine = optionalNumber(raw, 'endLine');
  const endColumn = optionalNumber(raw, 'endColumn');
  if (startColumn !== undefined) {
    (result as { startColumn?: number }).startColumn = startColumn;
  }
  if (endLine !== undefined) {
    (result as { endLine?: number }).endLine = endLine;
  }
  if (endColumn !== undefined) {
    (result as { endColumn?: number }).endColumn = endColumn;
  }
  const confidence = optionalString(raw, 'confidence');
  if (confidence !== undefined) {
    if (!EDGE_CONFIDENCE.has(confidence)) {
      throw new Error(`Invalid DependencyEdge.confidence: ${confidence}`);
    }
    (result as { confidence?: DependencyEdge['confidence'] }).confidence =
      confidence as DependencyEdge['confidence'];
  }
  const resolutionMethod = optionalString(raw, 'resolutionMethod');
  if (resolutionMethod !== undefined) {
    if (!EDGE_RESOLUTION.has(resolutionMethod)) {
      throw new Error(`Invalid DependencyEdge.resolutionMethod: ${resolutionMethod}`);
    }
    (result as { resolutionMethod?: DependencyEdge['resolutionMethod'] }).resolutionMethod =
      resolutionMethod as DependencyEdge['resolutionMethod'];
  }
  const evidence = raw.evidence;
  if (evidence !== undefined) {
    if (!Array.isArray(evidence) || !evidence.every((e) => typeof e === 'string')) {
      throw new Error('DependencyEdge.evidence must be string[] when present');
    }
    (result as { evidence?: string[] }).evidence = evidence as string[];
  }
  return result;
}

export function serializeDocumentChunk(value: DocumentChunk): string {
  return JSON.stringify(value);
}

export function parseDocumentChunk(json: string): DocumentChunk {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('DocumentChunk must be an object');
  }
  const kind = requireString(raw, 'kind');
  if (kind !== 'source' && kind !== 'memory' && kind !== 'config') {
    throw new Error(`Invalid DocumentChunk.kind: ${kind}`);
  }
  return {
    id: requireString(raw, 'id'),
    path: requireString(raw, 'path'),
    text: requireString(raw, 'text'),
    startLine: requireNumber(raw, 'startLine'),
    endLine: requireNumber(raw, 'endLine'),
    kind,
    symbol: optionalString(raw, 'symbol'),
    weight: requireNumber(raw, 'weight'),
    fileHash: requireString(raw, 'fileHash'),
  };
}

export function serializeSourceReference(value: SourceReference): string {
  return JSON.stringify(value);
}

export function parseSourceReference(json: string): SourceReference {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('SourceReference must be an object');
  }
  const path = requireString(raw, 'path').replace(/\\/g, '/');
  const authoredRaw = optionalString(raw, 'authored');
  const authored =
    authoredRaw === 'human' || authoredRaw === 'generated'
      ? authoredRaw
      : path.includes('/.mergecore/generated/')
        ? 'generated'
        : 'human';
  const extractionRaw = optionalString(raw, 'extraction');
  const extraction =
    extractionRaw === 'deterministic' || extractionRaw === 'heuristic'
      ? extractionRaw
      : 'deterministic';
  const result: SourceReference = {
    workspaceId: optionalString(raw, 'workspaceId') ?? 'unknown',
    path,
    startLine: requireNumber(raw, 'startLine'),
    endLine: requireNumber(raw, 'endLine'),
    sourceType: requireString(raw, 'sourceType') as SourceReference['sourceType'],
    sourceFingerprint:
      optionalString(raw, 'sourceFingerprint') ??
      optionalString(raw, 'fileHash') ??
      '',
    authored,
    extraction,
  };
  const startColumn = optionalNumber(raw, 'startColumn');
  const endColumn = optionalNumber(raw, 'endColumn');
  const symbol = optionalString(raw, 'symbol');
  const symbolId = optionalString(raw, 'symbolId');
  const excerpt = optionalString(raw, 'excerpt');
  const evidenceId = optionalString(raw, 'evidenceId');
  if (startColumn !== undefined) {
    (result as { startColumn?: number }).startColumn = startColumn;
  }
  if (endColumn !== undefined) {
    (result as { endColumn?: number }).endColumn = endColumn;
  }
  if (symbol !== undefined) {
    (result as { symbol?: string }).symbol = symbol;
  }
  if (symbolId !== undefined) {
    (result as { symbolId?: string }).symbolId = symbolId;
  }
  if (excerpt !== undefined) {
    (result as { excerpt?: string }).excerpt = excerpt;
  }
  if (evidenceId !== undefined) {
    (result as { evidenceId?: string }).evidenceId = evidenceId;
  }
  return result;
}

export function serializeContextClaim(value: ContextClaim): string {
  return JSON.stringify(value);
}

export function parseContextClaim(json: string): ContextClaim {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('ContextClaim must be an object');
  }
  let confidence = requireString(raw, 'confidence');
  if (confidence === 'uncertain') {
    confidence = 'low';
  }
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') {
    throw new Error(`Invalid ContextClaim.confidence: ${confidence}`);
  }
  const references = raw.references;
  if (!Array.isArray(references)) {
    throw new Error('ContextClaim.references must be an array');
  }
  const parsedRefs = references.map((r) => parseSourceReference(JSON.stringify(r)));
  const generalConsideration =
    optionalBoolean(raw, 'generalConsideration') === true || parsedRefs.length === 0;
  if (!generalConsideration && parsedRefs.length === 0) {
    throw new Error(
      'ContextClaim requires references or generalConsideration=true'
    );
  }
  const detailRaw = raw.confidenceDetail;
  let confidenceDetail: ContextClaim['confidenceDetail'];
  if (isObject(detailRaw) && isObject(detailRaw.components)) {
    const level = optionalString(detailRaw, 'level') ?? confidence;
    const levelNorm =
      level === 'high' || level === 'medium' || level === 'low' ? level : confidence;
    const rationale = Array.isArray(detailRaw.rationale)
      ? detailRaw.rationale.filter((x): x is string => typeof x === 'string')
      : [];
    confidenceDetail = {
      level: levelNorm as ContextClaim['confidence'],
      components: detailRaw.components as ContextClaim['confidenceDetail']['components'],
      rationale,
      diagnosticScore: optionalNumber(detailRaw, 'diagnosticScore'),
    };
  } else {
    confidenceDetail = {
      level: confidence as ContextClaim['confidence'],
      components: {
        independentSourceCount: parsedRefs.length,
        sourceFreshness: 'unknown',
        modelGenerated: false,
      },
      rationale: ['legacy-claim-without-detail'],
    };
  }
  return {
    id: requireString(raw, 'id'),
    text: requireString(raw, 'text'),
    confidence: confidence as ContextClaim['confidence'],
    confidenceDetail,
    references: parsedRefs,
    ...(generalConsideration ? { generalConsideration: true } : {}),
    score: optionalNumber(raw, 'score'),
  };
}

export function serializeContextResult(value: ContextResult): string {
  return JSON.stringify(value);
}

export function parseContextResult(json: string): ContextResult {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('ContextResult must be an object');
  }
  const claims = raw.claims;
  const references = raw.references;
  if (!Array.isArray(claims) || !Array.isArray(references)) {
    throw new Error('ContextResult.claims and references must be arrays');
  }
  const incomplete = raw.incomplete;
  if (typeof incomplete !== 'boolean') {
    throw new Error('ContextResult.incomplete must be boolean');
  }
  const notes = raw.notes;
  if (notes !== undefined && (!Array.isArray(notes) || !notes.every((n) => typeof n === 'string'))) {
    throw new Error('ContextResult.notes must be string[] when present');
  }
  return {
    workspaceRoot: requireString(raw, 'workspaceRoot'),
    query: requireString(raw, 'query'),
    claims: claims.map((c) => parseContextClaim(JSON.stringify(c))),
    references: references.map((r) => parseSourceReference(JSON.stringify(r))),
    incomplete,
    notes: notes as string[] | undefined,
  };
}

export function serializeInstructionRule(value: InstructionRule): string {
  return JSON.stringify(value);
}

export function parseInstructionRule(json: string): InstructionRule {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('InstructionRule must be an object');
  }
  return {
    id: requireString(raw, 'id'),
    text: requireString(raw, 'text'),
    source: parseSourceReference(JSON.stringify(raw.source)),
  };
}

export function serializeInstructionDocument(value: InstructionDocument): string {
  return JSON.stringify(value);
}

export function parseInstructionDocument(json: string): InstructionDocument {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('InstructionDocument must be an object');
  }
  const rules = raw.rules;
  if (!Array.isArray(rules)) {
    throw new Error('InstructionDocument.rules must be an array');
  }
  const kind = requireString(raw, 'kind');
  if (
    kind !== 'readme' &&
    kind !== 'agents' &&
    kind !== 'rules' &&
    kind !== 'architecture' &&
    kind !== 'other'
  ) {
    throw new Error(`Invalid InstructionDocument.kind: ${kind}`);
  }
  return {
    id: requireString(raw, 'id'),
    path: requireString(raw, 'path'),
    title: requireString(raw, 'title'),
    kind,
    rules: rules.map((r) => parseInstructionRule(JSON.stringify(r))),
    source: parseSourceReference(JSON.stringify(raw.source)),
  };
}

export function serializeContextPack(value: ContextPack): string {
  return JSON.stringify(value);
}

export function parseContextPack(json: string): ContextPack {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('ContextPack must be an object');
  }
  const claims = raw.claims;
  const instructions = raw.instructions;
  const references = raw.references;
  if (!Array.isArray(claims) || !Array.isArray(instructions) || !Array.isArray(references)) {
    throw new Error('ContextPack arrays must be present');
  }
  const incomplete = raw.incomplete;
  if (typeof incomplete !== 'boolean') {
    throw new Error('ContextPack.incomplete must be boolean');
  }
  return {
    id: requireString(raw, 'id'),
    workspaceRoot: requireString(raw, 'workspaceRoot'),
    query: requireString(raw, 'query'),
    createdAt: requireNumber(raw, 'createdAt'),
    claims: claims.map((c) => parseContextClaim(JSON.stringify(c))),
    instructions: instructions.map((i) => parseInstructionDocument(JSON.stringify(i))),
    references: references.map((r) => parseSourceReference(JSON.stringify(r))),
    incomplete,
  };
}

export function serializeIndexStatus(value: IndexStatus): string {
  return JSON.stringify(value);
}

export function parseIndexStatus(json: string): IndexStatus {
  const raw = JSON.parse(json) as unknown;
  if (!isObject(raw)) {
    throw new Error('IndexStatus must be an object');
  }
  const ready = raw.ready;
  const hasSqlite = raw.hasSqlite;
  const busy = raw.busy;
  const cancellable = raw.cancellable;
  if (
    typeof ready !== 'boolean' ||
    typeof hasSqlite !== 'boolean' ||
    typeof busy !== 'boolean' ||
    typeof cancellable !== 'boolean'
  ) {
    throw new Error('IndexStatus boolean fields invalid');
  }
  const result: IndexStatus = {
    workspaceRoot: requireString(raw, 'workspaceRoot'),
    workspaceId: requireString(raw, 'workspaceId'),
    ready,
    busy,
    phase: requireString(raw, 'phase') as IndexStatus['phase'],
    fileCount: requireNumber(raw, 'fileCount'),
    chunkCount: requireNumber(raw, 'chunkCount'),
    symbolCount: requireNumber(raw, 'symbolCount'),
    edgeCount: requireNumber(raw, 'edgeCount'),
    filesIndexed: requireNumber(raw, 'filesIndexed'),
    filesSkipped: requireNumber(raw, 'filesSkipped'),
    filesPending: requireNumber(raw, 'filesPending'),
    storeDir: requireString(raw, 'storeDir'),
    hasSqlite,
    schemaVersion: requireNumber(raw, 'schemaVersion'),
    cancellable,
  };
  const updatedAt = optionalNumber(raw, 'updatedAt');
  const fingerprint = optionalString(raw, 'fingerprint');
  const lastError = optionalString(raw, 'lastError');
  if (updatedAt !== undefined) {
    (result as { updatedAt?: number }).updatedAt = updatedAt;
  }
  if (fingerprint !== undefined) {
    (result as { fingerprint?: string }).fingerprint = fingerprint;
  }
  if (lastError !== undefined) {
    (result as { lastError?: string }).lastError = lastError;
  }
  const diagnostics = raw.diagnostics;
  if (diagnostics !== undefined) {
    if (!Array.isArray(diagnostics)) {
      throw new Error('IndexStatus.diagnostics must be an array when present');
    }
    (result as { diagnostics?: IndexStatus['diagnostics'] }).diagnostics = diagnostics.map((d) => {
      if (!isObject(d)) {
        throw new Error('AdapterDiagnostic must be an object');
      }
      const item: {
        path: string;
        startLine: number;
        endLine: number;
        severity: 'error' | 'warning' | 'info';
        message: string;
        code?: string;
      } = {
        path: requireString(d, 'path'),
        startLine: requireNumber(d, 'startLine'),
        endLine: requireNumber(d, 'endLine'),
        severity: requireString(d, 'severity') as 'error' | 'warning' | 'info',
        message: requireString(d, 'message'),
      };
      const code = optionalString(d, 'code');
      if (code !== undefined) {
        item.code = code;
      }
      return item;
    });
  }
  return result;
}
