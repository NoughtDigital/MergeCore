import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Single OutputChannel so raw server payloads, URL warnings and stack traces
 * never land in user-facing toasts.
 */
export class MergeCoreLogger {
  private static instance: MergeCoreLogger | undefined;
  private readonly channel: vscode.OutputChannel;

  private constructor() {
    this.channel = vscode.window.createOutputChannel('MergeCore');
  }

  static get shared(): MergeCoreLogger {
    if (!MergeCoreLogger.instance) {
      MergeCoreLogger.instance = new MergeCoreLogger();
    }
    return MergeCoreLogger.instance;
  }

  log(level: LogLevel, message: string, meta?: unknown): void {
    const stamp = new Date().toISOString();
    const prefix = `[${stamp}] ${level.toUpperCase()}`;
    const suffix = meta === undefined ? '' : ` ${safeStringify(meta)}`;
    this.channel.appendLine(`${prefix} ${message}${suffix}`);
  }

  debug(m: string, meta?: unknown): void { this.log('debug', m, meta); }
  info(m: string, meta?: unknown): void { this.log('info', m, meta); }
  warn(m: string, meta?: unknown): void { this.log('warn', m, meta); }
  error(m: string, meta?: unknown): void { this.log('error', m, meta); }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
    MergeCoreLogger.instance = undefined;
  }
}

function safeStringify(v: unknown): string {
  try {
    if (v instanceof Error) {
      return `${v.name}: ${v.message}`;
    }
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}
