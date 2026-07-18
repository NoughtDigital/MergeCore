import * as os from 'os';
import { scanForSecrets, redactSecrets, scrub } from '../secret-scrubber';

export interface DiagnosticsPayload {
  readonly exportedAt: string;
  readonly extensionVersion: string;
  readonly workspaceFingerprint: string | null;
  readonly workspaceLabel: string | null;
  readonly trusted: boolean;
  readonly privacy: {
    readonly externalRequestsEnabled: boolean;
    readonly modelProvider: string;
    readonly enableModelExplanation: boolean;
    readonly providerKeyPresent: boolean;
    readonly apiTokenPresent: boolean;
  };
  readonly index: {
    readonly storagePath: string | null;
    readonly indexedFileCount: number;
    readonly excludedFileCount: number;
    readonly chunkCount: number;
    readonly symbolCount: number;
    readonly indexSizeBytes: number | null;
    readonly lastCompletedIndexAt: string | null;
    readonly phase: string | null;
    readonly schemaVersion: number | null;
  };
  readonly ignoreRules: readonly string[];
  readonly transmittedRepositoryContent: boolean;
  readonly lastTransmissionAt: string | null;
  readonly envKeysPresent: readonly string[];
  readonly notes: readonly string[];
  readonly lastErrorMessage?: string | null;
}

export function redactHomePath(p: string, home = os.homedir()): string {
  const norm = p.replace(/\\/g, '/');
  const homeNorm = home.replace(/\\/g, '/');
  if (norm.startsWith(homeNorm)) {
    return `~${norm.slice(homeNorm.length)}`;
  }
  return p;
}

export function scrubDiagnosticsMessage(message: string): string {
  const { redacted } = scrub(redactHomePath(message));
  return redacted;
}

export function serialiseDiagnostics(payload: DiagnosticsPayload): string {
  let text = JSON.stringify(payload, null, 2);
  const hits = scanForSecrets(text);
  if (hits.length > 0) {
    text = redactSecrets(text, hits);
  }
  text = text.split(os.homedir()).join('~');
  return `${text}\n`;
}

export function assertNoSecretsInDiagnostics(text: string): void {
  const hits = scanForSecrets(text);
  if (hits.length > 0) {
    throw new Error(
      `Diagnostics export still contains secret-like material (${hits[0]!.rule})`
    );
  }
  if (text.includes(os.homedir()) && os.homedir().length > 3) {
    throw new Error('Diagnostics export still contains absolute home directory path');
  }
  if (/\bsk-[a-zA-Z0-9]{20,}\b/.test(text)) {
    throw new Error('Diagnostics export contained an OpenAI-like key pattern');
  }
  if (/Bearer\s+[A-Za-z0-9\-._~+/]+=*/i.test(text)) {
    throw new Error('Diagnostics export contained a bearer token pattern');
  }
}
