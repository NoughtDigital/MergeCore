import * as vscode from 'vscode';
import { createMergeCoreApp } from './composition-root';

export function activate(context: vscode.ExtensionContext): void {
  createMergeCoreApp(context);
}

export function deactivate(): void {}
