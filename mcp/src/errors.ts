export type McpErrorCode =
  | 'index_unavailable'
  | 'ambiguous_symbol'
  | 'unsupported_language'
  | 'workspace_not_permitted'
  | 'context_budget_exceeded'
  | 'malformed_request';

export interface McpStructuredError {
  readonly error: {
    readonly code: McpErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
}

export function structuredError(
  code: McpErrorCode,
  message: string,
  details?: unknown
): McpStructuredError {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

export function isStructuredError(value: unknown): value is McpStructuredError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as McpStructuredError).error?.code === 'string'
  );
}

export function textResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function errorResult(
  code: McpErrorCode,
  message: string,
  details?: unknown
) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(structuredError(code, message, details), null, 2),
      },
    ],
    isError: true as const,
  };
}

export function logMeta(tool: string, workspace: string, extra?: Record<string, unknown>): void {
  const bits = Object.entries(extra ?? {})
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  console.error(`[mergecore-mcp] tool=${tool} workspace=${workspace}${bits ? ` ${bits}` : ''}`);
}
