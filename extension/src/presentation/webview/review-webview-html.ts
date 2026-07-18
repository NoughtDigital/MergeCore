import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export function buildReviewPanelHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  assetVersion: string
): string {
  const v = encodeURIComponent(assetVersion);
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.js').with({ query: `v=${v}` })
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.css').with({ query: `v=${v}` })
  );
  const nonce = createNonce();

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; connect-src 'none'; frame-ancestors 'none'; base-uri 'none';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>MergeCore</title>
</head>
<body class="mc-body">
  <div class="mc-root">
    <header class="mc-header">
      <div class="mc-brand">
        <span class="mc-brand-mark" aria-hidden="true"></span>
        <div class="mc-brand-text">
          <div class="mc-brand-name">MergeCore</div>
          <div class="mc-brand-sub-row">
            <div id="brand-sub" class="mc-brand-sub">Second opinion against a senior bar</div>
            <span id="brand-level" class="mc-level-chip mc-hidden" hidden></span>
            <span id="brand-persona" class="mc-persona-chip mc-hidden" hidden></span>
          </div>
          <div id="brand-file" class="mc-brand-file" title=""></div>
        </div>
      </div>
      <button id="btn-export" type="button" class="mc-btn-ghost" title="Copy report as Markdown">Export MD</button>
    </header>

    <section class="mc-section mc-levels" aria-label="Review levels">
      <div class="mc-section-head">
        <h2 class="mc-section-title">Review</h2>
      </div>
      <div id="review-levels" class="mc-level-grid" role="group" aria-label="Multi-level review buttons"></div>
    </section>

    <section class="mc-hero" aria-label="Quality score">
      <div class="mc-score-ring" id="score-ring">
        <div class="mc-score-inner">
          <span id="score" class="mc-score-value">—</span>
          <span class="mc-score-denom">/10</span>
        </div>
      </div>
      <p id="score-caption" class="mc-score-caption mc-muted">Run a review to benchmark this change against that bar.</p>
    </section>

    <section id="score-breakdown" class="mc-section mc-score-breakdown" aria-label="Score detail" hidden>
      <div class="mc-section-head">
        <h2 class="mc-section-title">Score detail</h2>
      </div>
      <p id="score-why" class="mc-score-why"></p>
      <ul id="score-dimensions" class="mc-dimension-list" role="list"></ul>
      <div class="mc-score-split">
        <section class="mc-score-split-col" aria-label="What went well">
          <h3 class="mc-score-split-title">What went well</h3>
          <ul id="score-strengths" class="mc-bullet-list"></ul>
        </section>
        <section class="mc-score-split-col" aria-label="To reach 10">
          <h3 class="mc-score-split-title">To reach 10</h3>
          <ol id="score-path" class="mc-numbered-list"></ol>
        </section>
      </div>
      <p id="score-residual" class="mc-score-residual mc-muted mc-hidden" hidden></p>
    </section>

    <section class="mc-section">
      <div class="mc-section-head">
        <h2 class="mc-section-title">Summary</h2>
      </div>
      <p id="summary" class="mc-summary mc-muted">No review yet—run one when you want a second pair of eyes.</p>
    </section>

    <section class="mc-section">
      <div class="mc-section-head">
        <h2 class="mc-section-title">Findings</h2>
        <span id="findings-count" class="mc-pill mc-pill-muted">0</span>
      </div>
      <ul id="findings" class="mc-findings-list" role="list"></ul>
    </section>

    <section class="mc-section">
      <div class="mc-section-head">
        <h2 class="mc-section-title">Suggested rewrite</h2>
      </div>
      <p id="rewrite-summary" class="mc-rewrite-summary mc-muted mc-hidden" hidden></p>
      <ul id="rewrite-amends" class="mc-amends-list mc-hidden" hidden role="list"></ul>
      <div id="cross-file-panel" class="mc-cross-file-panel mc-hidden" hidden></div>
      <div id="rewrite-container" class="mc-rewrite-container" aria-label="Suggested full file">
        <div id="rewrite-lines" class="mc-rewrite-lines mc-code-block">—</div>
      </div>
      <p id="rewrite-apply-note" class="mc-apply-note mc-muted mc-hidden" hidden></p>
    </section>

    <footer class="mc-footer mc-hidden" hidden>
      <button id="btn-apply-code" type="button" class="mc-btn mc-btn-primary" disabled>Apply improved code</button>
      <button id="btn-apply-patch" type="button" class="mc-btn mc-btn-secondary" disabled>Apply patch</button>
    </footer>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * Cryptographically secure nonce. Base64 keeps the byte count compact enough
 * for the CSP header attribute while remaining unguessable.
 */
function createNonce(): string {
  return randomBytes(16).toString('base64');
}
