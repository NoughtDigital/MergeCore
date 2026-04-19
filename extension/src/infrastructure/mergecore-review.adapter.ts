import * as vscode from 'vscode';
import type { ReviewEngine } from '../application/ports/review-engine.port';
import type { ReviewRequest, ReviewResult } from '../domain/review-types';
import { omitRewriteIfUnchanged } from './review-result-normalize';

export class MergeCoreReviewAdapter implements ReviewEngine {
  constructor(private readonly mockReviewer: ReviewEngine) {}

  async review(request: ReviewRequest): Promise<ReviewResult> {
    const config = vscode.workspace.getConfiguration('mergecore');
    const useMock = config.get<boolean>('useMockReviewer', true);
    const token = config.get<string>('apiToken', '')?.trim();

    if (useMock || !token) {
      const r = await this.mockReviewer.review(request);
      return omitRewriteIfUnchanged(r, request.content);
    }

    const baseUrl = config.get<string>('apiBaseUrl', '').replace(/\/$/, '');
    const url = `${baseUrl}/v1/review`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scope: request.scope,
        workspaceRoot: request.workspaceRoot,
        projectProfile: request.projectProfile,
        filePath: request.filePath,
        languageId: request.languageId,
        label: request.label,
        content: request.content,
        selectionSnippet: request.selectionSnippet,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MergeCore API error ${response.status}: ${text.slice(0, 500)}`);
    }

    const body = (await response.json()) as ReviewResult;
    return omitRewriteIfUnchanged(normaliseResult(body), request.content);
  }
}

function normaliseResult(body: ReviewResult): ReviewResult {
  return {
    findings: body.findings ?? [],
    score: clampScore(body.score),
    summary: body.summary,
    improvedCode: body.improvedCode,
    rewriteSummary: body.rewriteSummary,
    rewriteAmends: body.rewriteAmends,
    crossFileImpacts: body.crossFileImpacts,
    patch: body.patch,
  };
}

function clampScore(score: number | undefined): number {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return 0;
  }
  let s = Math.max(0, score);
  if (s > 10) {
    s = s / 10;
  }
  return Math.min(10, Math.round(s * 10) / 10);
}
