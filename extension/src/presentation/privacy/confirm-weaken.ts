import * as vscode from 'vscode';
import {
  evaluatePathPrivacy,
  loadAllPrivacyRules,
  PRIVACY_STRENGTH,
  savePrivacyOverride,
  wouldWeaken,
  type PrivacyClassification,
  type PrivacyRule,
} from '@mergecore/intelligence';
import { readVscodeExtraExclusions } from '../../infrastructure/privacy/filter-model-evidence';

/**
 * Detect workspace rules that would weaken a stronger global/default rule
 * for concrete paths the user cares about (quick sample via open editors +
 * configured patterns). Prompt and record overrides on confirm.
 */
export async function confirmWeakenRestrictionsIfNeeded(
  workspaceRoot: string
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('mergecore');
  if (cfg.get<boolean>('privacy.confirmWeakenRestriction', true) !== true) {
    return;
  }

  const loaded = loadAllPrivacyRules({
    workspaceRoot,
    vscodeExtraExclusions: readVscodeExtraExclusions(),
  });

  const globalRules = loaded.rules.filter(
    (r) => r.source === 'global' || r.source === 'default'
  );
  const workspaceRules = loaded.rules.filter((r) => r.source === 'workspace');
  if (workspaceRules.length === 0 || globalRules.length === 0) {
    return;
  }

  const samplePaths = collectSamplePaths(workspaceRules);
  const weakenings: Array<{
    path: string;
    from: PrivacyClassification;
    to: PrivacyClassification;
    pattern: string;
  }> = [];

  for (const rel of samplePaths) {
    const withoutWorkspace = await evaluatePathPrivacy({
      workspaceRoot,
      relPath: rel,
      rules: [...globalRules, ...loaded.rules.filter((r) => r.source === 'vscode')],
      overrides: {},
      skipGlobalFile: true,
      allowWeakenWithoutOverride: true,
    });
    const withWorkspace = await evaluatePathPrivacy({
      workspaceRoot,
      relPath: rel,
      rules: loaded.rules,
      overrides: {},
      skipGlobalFile: true,
      allowWeakenWithoutOverride: true,
    });
    if (
      wouldWeaken(withoutWorkspace.classification, withWorkspace.classification) &&
      PRIVACY_STRENGTH[withoutWorkspace.classification] >
        PRIVACY_STRENGTH[withWorkspace.classification]
    ) {
      weakenings.push({
        path: rel,
        from: withoutWorkspace.classification,
        to: withWorkspace.classification,
        pattern: withWorkspace.matchedPattern ?? '(workspace rule)',
      });
    }
  }

  if (weakenings.length === 0) {
    return;
  }

  const summary = weakenings
    .slice(0, 5)
    .map((w) => `${w.path}: ${w.from} → ${w.to}`)
    .join('; ');
  const choice = await vscode.window.showWarningMessage(
    `Workspace privacy rules would weaken stronger restrictions (${summary}). Confirm and record overrides?`,
    { modal: true },
    'Confirm weaken',
    'Keep stronger rules'
  );
  if (choice !== 'Confirm weaken') {
    return;
  }
  for (const w of weakenings) {
    savePrivacyOverride(workspaceRoot, w.path, w.to);
  }
  void vscode.window.showInformationMessage(
    `Recorded ${weakenings.length} privacy override(s) in .mergecore/privacy-overrides.json.`
  );
}

function collectSamplePaths(workspaceRules: readonly PrivacyRule[]): string[] {
  const out = new Set<string>();
  for (const rule of workspaceRules) {
    const p = rule.pattern
      .replace(/^\*\*\//, '')
      .replace(/\*\*/g, 'x')
      .replace(/\*/g, 'sample');
    if (p.includes('/') || p.includes('.')) {
      out.add(p.replace(/\\/g, '/'));
    }
  }
  for (const ed of vscode.window.visibleTextEditors) {
    const folder = vscode.workspace.getWorkspaceFolder(ed.document.uri);
    if (!folder) continue;
    const rel = vscode.workspace.asRelativePath(ed.document.uri, false);
    if (rel && !rel.startsWith('..')) {
      out.add(rel.replace(/\\/g, '/'));
    }
  }
  return [...out].slice(0, 40);
}
