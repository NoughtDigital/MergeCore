import * as vscode from 'vscode';
import type { ReviewResult } from '../../domain/review-types';

export class ReviewSessionState {
  private result: ReviewResult | undefined;
  private target: vscode.Uri | undefined;

  set(result: ReviewResult, target: vscode.Uri): void {
    this.result = result;
    this.target = target;
    void this.updateContext();
  }

  clear(): void {
    this.result = undefined;
    this.target = undefined;
    void this.updateContext();
  }

  getSnapshot(): { result: ReviewResult; target: vscode.Uri } | undefined {
    if (!this.result || !this.target) {
      return undefined;
    }
    return { result: this.result, target: this.target };
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
