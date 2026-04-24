import * as vscode from 'vscode';
import type { ReviewResult } from '../../domain/review-types';
import type { ReviewDisplayInfo } from '../webview/review-display-context';

export class ReviewSessionState {
  private result: ReviewResult | undefined;
  private target: vscode.Uri | undefined;
  private display: ReviewDisplayInfo | undefined;

  set(result: ReviewResult, target: vscode.Uri, display?: ReviewDisplayInfo): void {
    this.result = result;
    this.target = target;
    this.display = display;
    void this.updateContext();
  }

  clear(): void {
    this.result = undefined;
    this.target = undefined;
    this.display = undefined;
    void this.updateContext();
  }

  getSnapshot():
    | { result: ReviewResult; target: vscode.Uri; display: ReviewDisplayInfo | undefined }
    | undefined {
    if (!this.result || !this.target) {
      return undefined;
    }
    return { result: this.result, target: this.target, display: this.display };
  }

  private async updateContext(): Promise<void> {
    const r = this.result;
    await vscode.commands.executeCommand(
      'setContext',
      'mergecore.canApplyImproved',
      Boolean(r?.improvedCode?.length)
    );
    await vscode.commands.executeCommand('setContext', 'mergecore.canApplyPatch', Boolean(r?.patch?.length));
  }
}
