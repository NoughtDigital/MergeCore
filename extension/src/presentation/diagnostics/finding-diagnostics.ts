import * as vscode from 'vscode';
import type { Finding } from '../../domain/review-types';

const SOURCE = 'mergecore';

export class FindingDiagnostics implements vscode.Disposable {
  readonly collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection(SOURCE);
  }

  setForDocument(document: vscode.TextDocument, findings: readonly Finding[]): void {
    const diagnostics = findings.map((f) => toDiagnostic(f, document));
    this.collection.set(document.uri, diagnostics);
  }

  clearDocument(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  dispose(): void {
    this.collection.dispose();
  }
}

function toDiagnostic(finding: Finding, document: vscode.TextDocument): vscode.Diagnostic {
  const lineIndex = finding.line !== undefined ? Math.max(0, finding.line - 1) : 0;
  const columnIndex = finding.column !== undefined ? Math.max(0, finding.column - 1) : 0;
  const line = document.lineAt(Math.min(lineIndex, document.lineCount - 1));
  const start = new vscode.Position(lineIndex, Math.min(columnIndex, line.range.end.character));
  const end =
    finding.line === undefined
      ? line.range.end
      : new vscode.Position(lineIndex, Math.min(columnIndex + 1, line.range.end.character));

  const d = new vscode.Diagnostic(new vscode.Range(start, end), finding.message, mapSeverity(finding.severity));
  d.source = SOURCE;
  d.code = finding.code ?? finding.id;
  return d;
}

function mapSeverity(severity: Finding['severity']): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'critical':
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'info':
      return vscode.DiagnosticSeverity.Information;
    case 'hint':
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}
