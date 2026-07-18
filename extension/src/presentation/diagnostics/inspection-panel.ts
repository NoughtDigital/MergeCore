import * as vscode from 'vscode';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function asRows(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) {
    return '<tr><td colspan="4"><em>None</em></td></tr>';
  }
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return `<tr><td colspan="4">${esc(String(item))}</td></tr>`;
      }
      const o = item as Record<string, unknown>;
      const path = esc(String(o.path ?? o.id ?? ''));
      const score =
        typeof o.score === 'number'
          ? o.score.toFixed(3)
          : typeof o.total === 'number'
            ? o.total.toFixed(3)
            : '';
      const type = esc(String(o.resultType ?? o.action ?? o.status ?? ''));
      const reason = esc(String(o.reason ?? o.message ?? o.label ?? ''));
      return `<tr><td>${path}</td><td>${type}</td><td>${score}</td><td>${reason}</td></tr>`;
    })
    .join('\n');
}

function budgetBar(
  label: string,
  used: number | undefined,
  max: number | undefined
): string {
  const u = used ?? 0;
  const m = max && max > 0 ? max : 1;
  const pct = Math.min(100, Math.round((u / m) * 100));
  return `<div class="bar-row"><span>${esc(label)}</span><div class="bar"><i style="width:${pct}%"></i></div><span>${u}/${max ?? '?'}</span></div>`;
}

/**
 * Paths and scores only — never render file bodies or excerpts.
 */
export function showRetrievalInspectionPanel(
  payload: Record<string, unknown>,
  title = 'MergeCore: Last Retrieval'
): void {
  const panel = vscode.window.createWebviewPanel(
    'mergecore.inspectLastRetrieval',
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: false, retainContextWhenHidden: true }
  );

  const query =
    typeof payload.originalQuery === 'string'
      ? payload.originalQuery
      : undefined;
  const normalised = Array.isArray(payload.normalisedQuery)
    ? (payload.normalisedQuery as string[]).map(esc).join(', ')
    : '';
  const fingerprint =
    typeof payload.queryFingerprint === 'string' ? payload.queryFingerprint : '';
  const stages = Array.isArray(payload.stages)
    ? (payload.stages as Array<{ name?: string; elapsedMs?: number }>)
        .map(
          (s) =>
            `<li><code>${esc(String(s.name ?? ''))}</code> — ${s.elapsedMs ?? 0} ms</li>`
        )
        .join('')
    : '';
  const budget = (payload.budgetUsage ?? {}) as Record<string, number>;
  const indexHealth = (payload.indexHealth ?? {}) as Record<string, unknown>;
  const notes = Array.isArray(payload.notes)
    ? (payload.notes as string[]).map((n) => `<li>${esc(n)}</li>`).join('')
    : '';
  const depPaths = Array.isArray(payload.dependencyPaths)
    ? (payload.dependencyPaths as Array<{ label?: string; score?: number }>)
        .map(
          (d) =>
            `<li>${esc(String(d.label ?? ''))}${
              typeof d.score === 'number' ? ` (${d.score.toFixed(2)})` : ''
            }</li>`
        )
        .join('')
    : '';

  const scoreComponents = Array.isArray(payload.scoreComponents)
    ? (payload.scoreComponents as Array<{
        id?: string;
        total?: number;
        breakdown?: Record<string, number>;
      }>)
        .slice(0, 40)
        .map((row) => {
          const parts = Object.entries(row.breakdown ?? {})
            .filter(([, v]) => typeof v === 'number' && v !== 0)
            .map(([k, v]) => `${esc(k)}=${(v as number).toFixed(2)}`)
            .join(', ');
          return `<tr><td>${esc(String(row.id ?? ''))}</td><td>${
            typeof row.total === 'number' ? row.total.toFixed(3) : ''
          }</td><td>${parts}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="3"><em>None</em></td></tr>';

  panel.webview.html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"/>
<title>${esc(title)}</title>
<style>
  body { margin:0; font-family:var(--vscode-font-family); color:var(--vscode-editor-foreground); background:var(--vscode-editor-background); padding:16px 20px 48px; }
  h1 { font-size:1.15rem; margin:0 0 8px; }
  h2 { font-size:1rem; margin:1.4em 0 0.4em; }
  .meta { color:var(--vscode-descriptionForeground); font-size:0.9em; margin-bottom:12px; }
  table { border-collapse:collapse; width:100%; font-size:0.9em; }
  th, td { border:1px solid var(--vscode-panel-border,#444); padding:4px 8px; text-align:left; vertical-align:top; }
  th { background:var(--vscode-editorWidget-background,rgba(127,127,127,.08)); }
  code { font-family:var(--vscode-editor-font-family,monospace); }
  .bar-row { display:grid; grid-template-columns:7rem 1fr 5rem; gap:8px; align-items:center; margin:4px 0; font-size:0.9em; }
  .bar { height:8px; background:var(--vscode-editorWidget-background,rgba(127,127,127,.2)); }
  .bar i { display:block; height:100%; background:var(--vscode-button-background); }
  ul { margin:0.25em 0 0.5em 1.2em; }
  .warn { border-left:3px solid var(--vscode-inputValidation-warningBorder,#cca700); padding:6px 10px; margin:8px 0; }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <p class="meta">Paths and scores only — no file bodies or excerpts.</p>
  ${
    query
      ? `<h2>Query (session)</h2><p><code>${esc(query)}</code></p>`
      : `<div class="warn">Original query is session-only. Showing redacted disk snapshot when available.</div>`
  }
  <h2>Normalised tokens</h2>
  <p>${normalised || '<em>None</em>'}</p>
  <p class="meta">Fingerprint: <code>${esc(fingerprint)}</code> · elapsed ${esc(
    String(payload.elapsedMs ?? '')
  )} ms · incomplete=${esc(String(payload.incomplete ?? false))}</p>

  <h2>Stage timings</h2>
  <ul>${stages || '<li><em>None (run with debug)</em></li>'}</ul>

  <h2>Budget</h2>
  ${budgetBar('chars', budget.usedChars, budget.maxChars)}
  ${budgetBar('files', budget.usedFiles, budget.maxFiles)}
  ${budgetBar('symbols', budget.usedSymbols, budget.maxSymbols)}
  ${budgetBar('chunks', budget.usedChunks, budget.maxChunks)}

  <h2>Index health</h2>
  <ul>
    <li>files: ${esc(String(indexHealth.fileCount ?? '?'))}</li>
    <li>chunks: ${esc(String(indexHealth.chunkCount ?? '?'))}</li>
    <li>incomplete: ${esc(String(indexHealth.incomplete ?? '?'))}</li>
    <li>possiblyStale: ${esc(String(indexHealth.possiblyStale ?? '?'))}</li>
    <li>schemaVersion: ${esc(String(indexHealth.schemaVersion ?? '?'))}</li>
  </ul>

  <h2>Candidates</h2>
  <table><thead><tr><th>Path / id</th><th>Type</th><th>Score</th><th>Note</th></tr></thead>
  <tbody>${asRows(payload.candidates)}</tbody></table>

  <h2>Selected paths</h2>
  <table><thead><tr><th>Path</th><th></th><th></th><th></th></tr></thead>
  <tbody>${asRows(
    Array.isArray(payload.selectedPaths)
      ? (payload.selectedPaths as string[]).map((p) => ({ path: p }))
      : []
  )}</tbody></table>

  <h2>Rejected / filtering</h2>
  <table><thead><tr><th>Path</th><th>Action</th><th></th><th>Reason</th></tr></thead>
  <tbody>${asRows(payload.rejected ?? payload.filtering)}</tbody></table>

  <h2>Score components</h2>
  <table><thead><tr><th>Id</th><th>Total</th><th>Breakdown</th></tr></thead>
  <tbody>${scoreComponents}</tbody></table>

  <h2>Source freshness</h2>
  <table><thead><tr><th>Path</th><th>Status</th><th></th><th></th></tr></thead>
  <tbody>${asRows(payload.sourceFreshness)}</tbody></table>

  <h2>Parser failures</h2>
  <table><thead><tr><th>Path</th><th></th><th></th><th>Message</th></tr></thead>
  <tbody>${asRows(payload.parserFailures)}</tbody></table>

  <h2>Dependency paths</h2>
  <ul>${depPaths || '<li><em>None</em></li>'}</ul>

  <h2>Notes</h2>
  <ul>${notes || '<li><em>None</em></li>'}</ul>
</body>
</html>`;
}

export function showUsageMetricsPanel(metrics: Record<string, unknown>): void {
  const panel = vscode.window.createWebviewPanel(
    'mergecore.showUsageMetrics',
    'MergeCore: Usage Metrics',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: false }
  );
  const rows = Object.entries(metrics)
    .filter(([k]) => k !== 'frequentSourceHashes' && k !== 'lowConfidenceQueryFingerprints')
    .map(
      ([k, v]) =>
        `<tr><td>${esc(k)}</td><td><code>${esc(
          typeof v === 'object' ? JSON.stringify(v) : String(v)
        )}</code></td></tr>`
    )
    .join('');
  const hashes = (metrics.frequentSourceHashes ?? {}) as Record<string, number>;
  const hashRows = Object.entries(hashes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(
      ([h, n]) =>
        `<tr><td><code>${esc(h)}</code></td><td>${n}</td></tr>`
    )
    .join('');

  panel.webview.html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"/>
<title>Usage metrics</title>
<style>
  body { font-family:var(--vscode-font-family); color:var(--vscode-editor-foreground); background:var(--vscode-editor-background); padding:16px 20px; }
  table { border-collapse:collapse; width:100%; }
  th, td { border:1px solid var(--vscode-panel-border,#444); padding:4px 8px; text-align:left; }
  .meta { color:var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <h1>Local usage metrics</h1>
  <p class="meta">Stored under <code>.mergecore/diagnostics/</code>. No filenames or query text in counters.</p>
  <table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Frequent source hashes</h2>
  <table><thead><tr><th>Path hash</th><th>Count</th></tr></thead><tbody>${
    hashRows || '<tr><td colspan="2"><em>None</em></td></tr>'
  }</tbody></table>
</body>
</html>`;
}
