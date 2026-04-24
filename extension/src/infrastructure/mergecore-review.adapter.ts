import * as vscode from 'vscode';
import type { ReviewEngine } from '../application/ports/review-engine.port';
import type { ReviewRequest, ReviewResult } from '../domain/review-types';
import {
  describeOriginForPrompt,
  validateApiBaseUrl,
} from './api-base-url';
import { MergeCoreLogger } from './logger';
import { formatRelatedContextDigest } from './related-context.collector';
import { omitRewriteIfUnchanged } from './review-result-normalize';
import { parseReviewResult, ReviewResponseError } from './review-response.guard';
import type { MergeCoreSecretStore } from './secret-store';

const TOKEN_NOT_SET_KEY = 'apiTokenMissingNoticeSeen';
const ORIGIN_APPROVED_PREFIX = 'mergecore.trustedOrigin:';
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * HTTP adapter for the MergeCore review API. Responsibilities in one place:
 *  - pick between mock and real engine based on config + presence of a secret
 *  - validate apiBaseUrl (https-only, explicit opt-in for local http)
 *  - require explicit consent before talking to a non-default origin
 *  - bound every request with a timeout and external abort signal
 *  - validate the wire-shape before it reaches the rest of the extension
 *  - map provider errors to coarse user messages; raw bodies go to logs only
 */
export class MergeCoreReviewAdapter implements ReviewEngine {
  constructor(
    private readonly mockReviewer: ReviewEngine,
    private readonly secrets: MergeCoreSecretStore,
    private readonly memento: vscode.Memento,
    private readonly externalSignal: () => AbortSignal | undefined = () => undefined
  ) {}

  async review(request: ReviewRequest): Promise<ReviewResult> {
    const config = vscode.workspace.getConfiguration('mergecore');
    const useMock = config.get<boolean>('useMockReviewer', true);
    const token = (await this.secrets.getApiToken())?.trim();

    if (useMock || !token) {
      if (!useMock && !token) {
        await this.notifyMissingTokenOnce();
      }
      const r = await this.mockReviewer.review(request);
      return omitRewriteIfUnchanged(r, request.content);
    }

    const allowInsecureLocal = config.get<boolean>('allowInsecureLocalApi', false);
    const base = config.get<string>('apiBaseUrl', '');
    const validated = validateApiBaseUrl(base, allowInsecureLocal);
    if (!validated.ok || !validated.url) {
      throw new Error(validated.reason ?? 'API base URL is invalid.');
    }
    if (validated.warning) {
      MergeCoreLogger.shared.warn(validated.warning);
    }

    if (!(await this.ensureOriginApproved(validated.url))) {
      throw new Error('Review cancelled: API origin was not approved.');
    }

    const timeoutMs = Math.max(5_000, config.get<number>('apiTimeoutMs', DEFAULT_TIMEOUT_MS));
    const url = new URL('/v1/review', validated.url.origin + validated.url.pathname.replace(/\/$/, '') + '/').toString();

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    const external = this.externalSignal();
    if (external) {
      if (external.aborted) {
        controller.abort(external.reason);
      } else {
        external.addEventListener('abort', () => controller.abort(external.reason), { once: true });
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'MergeCore-Extension',
        },
        body: JSON.stringify({
          scope: request.scope,
          workspaceRoot: request.workspaceRoot,
          projectProfile: request.projectProfile,
          relatedContext: request.relatedContext,
          relatedContextDigest: formatRelatedContextDigest(request.relatedContext),
          filePath: request.filePath,
          languageId: request.languageId,
          label: request.label,
          content: request.content,
          selectionSnippet: request.selectionSnippet,
          reviewerPersonaId: request.reviewerPersonaId,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) {
        MergeCoreLogger.shared.warn('Review request aborted', e);
        throw new Error('Review cancelled or timed out.');
      }
      MergeCoreLogger.shared.error('Network error contacting MergeCore API', e);
      throw new Error('Could not reach the MergeCore API. Check your network and try again.');
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      const rawBody = await safeReadBody(response);
      MergeCoreLogger.shared.error(`API ${response.status} ${response.statusText}`, rawBody);
      throw new Error(friendlyStatus(response.status));
    }

    let bodyJson: unknown;
    try {
      bodyJson = await response.json();
    } catch (e) {
      MergeCoreLogger.shared.error('API returned non-JSON body', e);
      throw new Error('MergeCore API returned an unexpected response. See the MergeCore output channel for details.');
    }

    let parsed: ReviewResult;
    try {
      parsed = parseReviewResult(bodyJson);
    } catch (e) {
      if (e instanceof ReviewResponseError) {
        MergeCoreLogger.shared.error(`API response validation failed: ${e.message}`, bodyJson);
      } else {
        MergeCoreLogger.shared.error('Unexpected error validating API response', e);
      }
      throw new Error('MergeCore API response failed validation. See the MergeCore output channel for details.');
    }

    return omitRewriteIfUnchanged(parsed, request.content);
  }

  private async notifyMissingTokenOnce(): Promise<void> {
    if (this.memento.get<boolean>(TOKEN_NOT_SET_KEY, false)) {
      return;
    }
    await this.memento.update(TOKEN_NOT_SET_KEY, true);
    const action = 'Set API Token';
    const choice = await vscode.window.showInformationMessage(
      'MergeCore: no API token is stored, falling back to the mock reviewer. Run "MergeCore: Set API Token" to use the real reviewer.',
      action
    );
    if (choice === action) {
      void vscode.commands.executeCommand('mergecore.setApiToken');
    }
  }

  private async ensureOriginApproved(url: URL): Promise<boolean> {
    const origin = describeOriginForPrompt(url);
    const key = `${ORIGIN_APPROVED_PREFIX}${origin}`;
    if (this.memento.get<boolean>(key, false)) {
      return true;
    }
    const approve = 'Send to this host';
    const cancel = 'Cancel';
    const choice = await vscode.window.showWarningMessage(
      `MergeCore will send your source code and token to ${origin}. Approve this origin for future requests?`,
      { modal: true, detail: 'Origins must be approved once per machine to prevent a settings-sync or workspace override from silently redirecting your token.' },
      approve,
      cancel
    );
    if (choice !== approve) {
      return false;
    }
    await this.memento.update(key, true);
    return true;
  }
}

function friendlyStatus(status: number): string {
  if (status === 401 || status === 403) {
    return 'MergeCore API rejected the token (401/403). Run "MergeCore: Set API Token" to rotate it.';
  }
  if (status === 404) {
    return 'MergeCore API endpoint not found (404). Check mergecore.apiBaseUrl.';
  }
  if (status === 413) {
    return 'Input is too large for the MergeCore API (413). Try a smaller selection or staged diff.';
  }
  if (status === 429) {
    return 'MergeCore API rate-limited this client (429). Please slow down and retry shortly.';
  }
  if (status >= 500) {
    return `MergeCore API is unavailable (${status}). Check the MergeCore output channel for details.`;
  }
  return `MergeCore API error (${status}). Check the MergeCore output channel for details.`;
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 2000);
  } catch {
    return '<could not read body>';
  }
}
