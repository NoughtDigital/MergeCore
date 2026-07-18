#!/usr/bin/env node
/**
 * MergeCore MCP server — stdio tools for Cursor / Codex agents.
 * Logs go to stderr; stdout is reserved for JSON-RPC.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  buildIndexStatusPayload,
  toolAnalyseChangeImpact,
  toolExplainContext,
  toolExplainSymbol,
  toolGenerateTaskContext,
  toolGetArchitectureSummary,
  toolGetRelatedFiles,
  toolGetRelevantInstructions,
  toolIndexRepository,
  toolIndexStatus,
  toolListPacks,
  toolReadPackGuidance,
  toolRetrieve,
  toolScanProdRisks,
  toolSearchRepositoryContext,
  toolWorkspaceProfile,
} from './tools.js';
import { resolveWorkspaceRoot } from './workspace.js';

const explanationMode = z.enum(['junior', 'mid', 'senior', 'expert']);
const intelligenceProfile = z.enum([
  'default',
  'startup-mvp',
  'enterprise',
  'performance',
  'security',
  'solo-founder',
  'rapid-prototyping',
  'ai-safety',
]);

const relationshipKind = z.enum([
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
  'route',
  'job',
  'event',
  'integration',
  'documentation',
]);

function createServer(): McpServer {
  const server = new McpServer({
    name: 'mergecore',
    version: '0.1.0',
  });

  // --- Commercial tools ---

  server.tool(
    'search_repository_context',
    'Hybrid repository search: ranked files/symbols/chunks with reasons, confidence, and source refs.',
    {
      query: z.string().describe('Natural-language or symbol query'),
      k: z.number().int().min(1).max(32).optional(),
      pathHint: z.string().optional().describe('Prefer hits near this relative path'),
      maxFiles: z.number().int().min(1).max(64).optional(),
      maxSymbols: z.number().int().min(1).max(64).optional(),
      maxDependencyDepth: z.number().int().min(0).max(6).optional(),
      preferMemory: z.boolean().optional(),
      mode: explanationMode.optional(),
      profile: intelligenceProfile.optional(),
    },
    async (args) => toolSearchRepositoryContext(args)
  );

  server.tool(
    'explain_symbol',
    'Explain a symbol from the local graph: purpose, signature, deps, callers, tests, instructions, risks (no model).',
    {
      symbol: z.string().describe('Symbol name'),
      filePath: z.string().optional().describe('Relative path to disambiguate'),
      exact: z.boolean().optional().describe('Require exact name match'),
    },
    async (args) => toolExplainSymbol(args)
  );

  server.tool(
    'get_relevant_instructions',
    'Return scoped instructions, conflicts, and precedence for a target file.',
    {
      targetFile: z.string().describe('Relative path of the file under consideration'),
    },
    async (args) => toolGetRelevantInstructions(args)
  );

  server.tool(
    'get_related_files',
    'Find related files via code graph and hybrid search, filtered by relationship kinds and depth.',
    {
      query: z.string().optional(),
      filePath: z.string().optional(),
      symbol: z.string().optional(),
      maxDepth: z.number().int().min(0).max(6).optional(),
      relationshipKinds: z.array(relationshipKind).optional(),
      k: z.number().int().min(1).max(48).optional(),
    },
    async (args) => toolGetRelatedFiles(args)
  );

  server.tool(
    'analyse_change_impact',
    'Likely (not guaranteed) change impact: dependents, downstream paths, tests, public interfaces, integrations, and uncertain dynamics.',
    {
      symbol: z.string().optional().describe('Symbol name'),
      filePath: z.string().optional().describe('Relative path to disambiguate or target a file'),
      maxDepth: z.number().int().min(1).max(6).optional(),
      maxPaths: z.number().int().min(1).max(40).optional(),
    },
    async (args) => toolAnalyseChangeImpact(args)
  );

  server.tool(
    'generate_task_context',
    'Generate a focused Markdown task context pack (instructions, components, deps, tests, risks, sources). Deterministic; local only.',
    {
      task: z.string().describe('Software task description'),
      selectedFiles: z.array(z.string()).optional(),
      depth: z.enum(['shallow', 'standard', 'deep']).optional(),
      persist: z
        .boolean()
        .optional()
        .describe('Write under .mergecore/generated/context-packs/ (default true)'),
    },
    async (args) => toolGenerateTaskContext(args)
  );

  server.tool(
    'get_architecture_summary',
    'Evidence-backed architecture summary from memory, ADRs, and indexed entry points (no model).',
    {
      directory: z.string().optional().describe('Optional directory scope'),
      k: z.number().int().min(1).max(32).optional(),
    },
    async (args) => toolGetArchitectureSummary(args)
  );

  server.tool(
    'index_status',
    'Report local RAG index status: workspace, readiness, counts, schema version, failure counts.',
    {},
    async () => toolIndexStatus()
  );

  server.registerResource(
    'index_status',
    'mergecore://index/status',
    {
      description: 'Local MergeCore index status (same payload as index_status tool)',
      mimeType: 'application/json',
    },
    async () => {
      const result = await buildIndexStatusPayload();
      const text = result.content[0]?.text ?? '{}';
      return {
        contents: [
          {
            uri: 'mergecore://index/status',
            mimeType: 'application/json',
            text,
          },
        ],
      };
    }
  );

  // --- Compatibility aliases ---

  server.tool(
    'mergecore_index_status',
    'Alias of index_status.',
    {},
    async () => toolIndexStatus()
  );

  server.tool(
    'mergecore_index',
    'Index the workspace into .mergecore/rag/ (local-first; may take a while on large repos).',
    {},
    async () => toolIndexRepository()
  );

  server.tool(
    'mergecore_retrieve',
    'Alias of search_repository_context (hybrid search).',
    {
      query: z.string().describe('Natural-language or symbol query'),
      k: z.number().int().min(1).max(32).optional().describe('Max hits (default 8)'),
      pathHint: z.string().optional().describe('Prefer chunks near this relative path'),
      mode: explanationMode.optional(),
      profile: intelligenceProfile.optional(),
      preferMemory: z.boolean().optional().describe('Prefer markdown memory chunks (default true)'),
    },
    async (args) => toolRetrieve(args)
  );

  server.tool(
    'mergecore_explain_context',
    'Alias of explain_symbol.',
    {
      symbol: z.string().describe('Symbol or type name to explain'),
      filePath: z.string().optional().describe('Optional relative file path hint'),
      k: z.number().int().min(1).max(32).optional(),
    },
    async (args) => toolExplainContext(args)
  );

  server.tool(
    'mergecore_scan_prod_risks',
    'Run the pack-aware production-risk scan against the workspace.',
    {
      files: z
        .array(z.string())
        .optional()
        .describe('Optional relative file paths to limit the scan'),
    },
    async (args) => toolScanProdRisks(args)
  );

  server.tool(
    'mergecore_list_packs',
    'List registered rules packs from rules/registry.json (if present).',
    {},
    async () => toolListPacks()
  );

  server.tool(
    'mergecore_read_pack_guidance',
    'Read pack.json and agents.md for a registered pack id.',
    {
      packId: z.string().describe('Pack id from mergecore_list_packs'),
    },
    async (args) => toolReadPackGuidance(args)
  );

  server.tool(
    'mergecore_generate_task_context',
    'Alias of generate_task_context.',
    {
      task: z.string().describe('Software task description, e.g. Add partial refunds to subscriptions'),
      selectedFiles: z
        .array(z.string())
        .optional()
        .describe('Optional relative file paths to pin'),
      depth: z
        .enum(['shallow', 'standard', 'deep'])
        .optional()
        .describe('Retrieval depth (default standard)'),
      persist: z
        .boolean()
        .optional()
        .describe('Write under .mergecore/generated/context-packs/ (default true)'),
    },
    async (args) => toolGenerateTaskContext(args)
  );

  server.tool(
    'mergecore_workspace_profile',
    'Collect stack signals, conventions, and fingerprint for the workspace.',
    {},
    async () => toolWorkspaceProfile()
  );

  return server;
}

async function main(): Promise<void> {
  const workspace = resolveWorkspaceRoot();
  console.error(`[mergecore-mcp] workspace=${workspace}`);
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mergecore-mcp] listening on stdio');
}

main().catch((err) => {
  console.error('[mergecore-mcp] fatal:', err);
  process.exit(1);
});
