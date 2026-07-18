/**
 * Pure privacy gate (no vscode dependency) for tests and hosts.
 */

export type PrivacyGateCode =
  | 'untrusted'
  | 'external_disabled'
  | 'consent_cancelled'
  | 'provider_none'
  | 'missing_key';

export class PrivacyGateError extends Error {
  constructor(
    message: string,
    readonly code: PrivacyGateCode
  ) {
    super(message);
    this.name = 'PrivacyGateError';
  }
}

export const EXTERNAL_EVIDENCE_CONSENT_KEY = 'mergecore.privacy.externalEvidenceConsent';
export const LAST_TRANSMISSION_KEY = 'mergecore.privacy.lastModelTransmissionAt';
export const LAST_EVIDENCE_PREVIEW_KEY = 'mergecore.privacy.lastEvidencePreview';

export interface PrivacyGateCoreInput {
  readonly isTrusted: boolean;
  readonly requiresExternal: boolean;
  readonly externalRequestsEnabled: boolean;
  readonly alreadyConsented: boolean;
  readonly confirmChoice?: 'Allow once' | 'Always allow' | 'Cancel' | undefined;
}

export type PrivacyGateCoreResult =
  | { readonly ok: true; readonly persistAlwaysAllow?: boolean }
  | { readonly ok: false; readonly error: PrivacyGateError };

export function evaluateExternalSendGate(
  input: PrivacyGateCoreInput
): PrivacyGateCoreResult {
  if (!input.isTrusted) {
    return {
      ok: false,
      error: new PrivacyGateError(
        'MergeCore privacy actions that send repository content require a trusted workspace.',
        'untrusted'
      ),
    };
  }
  if (!input.requiresExternal) {
    return { ok: true };
  }
  if (!input.externalRequestsEnabled) {
    return {
      ok: false,
      error: new PrivacyGateError(
        'External requests are disabled. Enable them in MergeCore privacy settings or use a local provider.',
        'external_disabled'
      ),
    };
  }
  if (input.alreadyConsented) {
    return { ok: true };
  }
  if (input.confirmChoice === 'Cancel' || input.confirmChoice === undefined) {
    return {
      ok: false,
      error: new PrivacyGateError(
        'External send cancelled by the user.',
        'consent_cancelled'
      ),
    };
  }
  if (input.confirmChoice === 'Always allow') {
    return { ok: true, persistAlwaysAllow: true };
  }
  return { ok: true };
}
