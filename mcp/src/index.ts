#!/usr/bin/env node
/**
 * MergeCore MCP server — stdio tools for Cursor / Codex agents.
 * Logs go to stderr; stdout is reserved for JSON-RPC.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  toolExplainContext,
  toolIndexRepository,
  toolIndexStatus,
  toolListPacks,
  toolReadPackGuidance,
  toolRetrieve,
  toolScanProdRisks,
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

function createServer(): McpServer {
  const server = new McpServer({
    name: 'mergecore',
    version: '0.1.0',
  });

  server.tool(
    'mergecore_index_status',
    'Report local RAG index status for MERGECORE_WORKSPACE (chunk/file counts).',
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
    'Retrieve relevant repository memory and code chunks from the local RAG store.',
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
    'Gather RAG context for a symbol (agent equivalent of hover explanation inputs).',
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
