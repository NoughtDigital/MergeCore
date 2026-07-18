(function () {
  const vscode = acquireVsCodeApi();

  const scoreEl = document.getElementById('score');
  const scoreRing = document.getElementById('score-ring');
  const scoreCaption = document.getElementById('score-caption');
  const scoreBreakdownEl = document.getElementById('score-breakdown');
  const scoreWhyEl = document.getElementById('score-why');
  const scoreDimensionsEl = document.getElementById('score-dimensions');
  const scoreStrengthsEl = document.getElementById('score-strengths');
  const scorePathEl = document.getElementById('score-path');
  const scoreResidualEl = document.getElementById('score-residual');
  const brandSubEl = document.getElementById('brand-sub');
  const brandFileEl = document.getElementById('brand-file');
  const brandPersonaEl = document.getElementById('brand-persona');
  const brandLevelEl = document.getElementById('brand-level');
  const summaryEl = document.getElementById('summary');
  const findingsEl = document.getElementById('findings');
  const findingsCount = document.getElementById('findings-count');
  const rewriteSummaryEl = document.getElementById('rewrite-summary');
  const rewriteAmendsEl = document.getElementById('rewrite-amends');
  const crossFilePanelEl = document.getElementById('cross-file-panel');
  const rewriteLinesEl = document.getElementById('rewrite-lines');
  const rewriteApplyNoteEl = document.getElementById('rewrite-apply-note');
  const btnApplyCode = document.getElementById('btn-apply-code');
  const btnApplyPatch = document.getElementById('btn-apply-patch');
  const applyFooterEl = document.querySelector('.mc-footer');
  const btnExport = document.getElementById('btn-export');
  const reviewLevelsEl = document.getElementById('review-levels');

  // pendingLevelId: click acknowledged, waiting for host to start or reject.
  // inFlightLevelId: host confirmed the review is running (show "Reviewing…").
  // Never treat click alone as in-flight — empty-scope exits never publish a
  // review result, so a click-time lock would hang the buttons forever.
  let pendingLevelId = null;
  let inFlightLevelId = null;
  let levelWatchdogTimer = null;
  const LEVEL_WATCHDOG_MS = 10_000;

  function clearLevelWatchdog() {
    if (levelWatchdogTimer !== null) {
      clearTimeout(levelWatchdogTimer);
      levelWatchdogTimer = null;
    }
  }

  function clearLevelBusyState() {
    clearLevelWatchdog();
    pendingLevelId = null;
    inFlightLevelId = null;
    refreshLevelButtons();
  }

  function armLevelWatchdog() {
    clearLevelWatchdog();
    levelWatchdogTimer = setTimeout(function () {
      levelWatchdogTimer = null;
      pendingLevelId = null;
      inFlightLevelId = null;
      refreshLevelButtons();
    }, LEVEL_WATCHDOG_MS);
  }

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (!msg) {
      return;
    }
    if (msg.type === 'review') {
      clearLevelBusyState();
      render(msg.payload);
      return;
    }
    if (msg.type === 'reviewLevels') {
      renderLevelButtons(Array.isArray(msg.payload) ? msg.payload : []);
      refreshLevelButtons();
      return;
    }
    if (msg.type === 'reviewState' && msg.payload && typeof msg.payload === 'object') {
      if (msg.payload.running === true) {
        // Host confirmed work started — promote pending to in-flight.
        // Drop the short pending watchdog; the host clears idle when done.
        clearLevelWatchdog();
        inFlightLevelId = pendingLevelId || inFlightLevelId;
        pendingLevelId = null;
        refreshLevelButtons();
      } else {
        clearLevelBusyState();
      }
      return;
    }
  });

  // Ask the host for the canonical level list so new levels added in the
  // domain layer light up in the sidebar without touching this file.
  vscode.postMessage({ type: 'requestReviewLevels' });

  btnApplyCode.addEventListener('click', function () {
    vscode.postMessage({ type: 'applyImproved' });
  });

  btnApplyPatch.addEventListener('click', function () {
    vscode.postMessage({ type: 'applyPatch' });
  });

  btnExport.addEventListener('click', function () {
    vscode.postMessage({ type: 'exportMarkdown' });
  });

  function render(payload) {
    if (!payload) {
      return;
    }

    const display = payload.display || {};
    const stackLine = typeof display.stackLine === 'string' ? display.stackLine : '';

    if (brandSubEl) {
      brandSubEl.textContent = stackLine || 'Second opinion against a senior bar';
    }
    if (brandFileEl) {
      const fl = typeof display.fileLabel === 'string' ? display.fileLabel : '';
      brandFileEl.textContent = fl;
      brandFileEl.title = fl;
    }
    if (brandPersonaEl) {
      const badge = typeof display.personaBadge === 'string' ? display.personaBadge.trim() : '';
      const title = typeof display.personaTitle === 'string' ? display.personaTitle.trim() : '';
      if (badge) {
        brandPersonaEl.textContent = badge;
        brandPersonaEl.title = title || badge;
        brandPersonaEl.hidden = false;
        brandPersonaEl.classList.remove('mc-hidden');
      } else {
        brandPersonaEl.textContent = '';
        brandPersonaEl.title = '';
        brandPersonaEl.hidden = true;
        brandPersonaEl.classList.add('mc-hidden');
      }
    }

    if (brandLevelEl) {
      const lb = typeof display.levelBadge === 'string' ? display.levelBadge.trim() : '';
      const lt = typeof display.levelTitle === 'string' ? display.levelTitle.trim() : '';
      if (lb) {
        brandLevelEl.textContent = lb;
        brandLevelEl.title = lt || lb;
        brandLevelEl.hidden = false;
        brandLevelEl.classList.remove('mc-hidden');
      } else {
        brandLevelEl.textContent = '';
        brandLevelEl.title = '';
        brandLevelEl.hidden = true;
        brandLevelEl.classList.add('mc-hidden');
      }
    }

    const n = normaliseScore(payload.score);
    if (n === null) {
      scoreEl.textContent = '—';
      scoreRing.className = 'mc-score-ring';
      if (scoreBreakdownEl) {
        scoreBreakdownEl.hidden = true;
      }
    } else {
      scoreEl.textContent = formatScore(n);
      scoreRing.className = 'mc-score-ring ' + scoreBandClass(n);
      scoreCaption.textContent = scoreCaptionFor(n, stackLine);
      renderScoreBreakdown(payload);
    }

    summaryEl.textContent = payload.summary || 'No summary.';

    findingsEl.innerHTML = '';
    const items = Array.isArray(payload.findings) ? payload.findings : [];
    findingsCount.textContent = String(items.length);

    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'mc-empty';
      li.textContent = 'No findings. Clean pass for this scope.';
      findingsEl.appendChild(li);
    } else {
      items.forEach(function (f, index) {
        findingsEl.appendChild(renderFinding(f, index));
      });
    }

    renderRewriteSection(payload);
    updateApplyFooter(payload);
  }

  function updateApplyFooter(payload) {
    const hasCode = payload.improvedCode && String(payload.improvedCode).trim();
    const hasPatch = Boolean(payload.patch && String(payload.patch).trim());

    if (btnApplyCode) {
      btnApplyCode.disabled = !hasCode;
    }
    if (btnApplyPatch) {
      btnApplyPatch.disabled = !hasPatch;
    }
    if (applyFooterEl) {
      const show = Boolean(hasCode || hasPatch);
      applyFooterEl.hidden = !show;
      applyFooterEl.classList.toggle('mc-hidden', !show);
    }
  }

  function renderScoreBreakdown(payload) {
    if (!scoreBreakdownEl || !scoreWhyEl || !scoreDimensionsEl || !scoreStrengthsEl || !scorePathEl) {
      return;
    }
    const ins = payload.scoreInsight;
    if (!ins) {
      scoreBreakdownEl.hidden = true;
      return;
    }
    scoreBreakdownEl.hidden = false;
    scoreWhyEl.textContent = ins.whyText || '';

    scoreDimensionsEl.textContent = '';
    (ins.dimensions || []).forEach(function (d) {
      const li = document.createElement('li');
      li.className = 'mc-dimension-item';
      li.setAttribute('role', 'listitem');
      const sub = typeof d.subScore === 'number' ? formatScore(d.subScore) : '—';
      const lab = d.label || d.key || '';

      const spLabel = document.createElement('span');
      spLabel.className = 'mc-dimension-label';
      spLabel.textContent = String(lab);
      const spLevel = document.createElement('span');
      spLevel.className = 'mc-dimension-level';
      spLevel.textContent = String(d.level || '');
      const spSub = document.createElement('span');
      spSub.className = 'mc-dimension-sub';
      spSub.textContent = String(sub) + '/10';

      li.appendChild(spLabel);
      li.appendChild(spLevel);
      li.appendChild(spSub);
      scoreDimensionsEl.appendChild(li);
    });

    scoreStrengthsEl.innerHTML = '';
    (ins.strengths || []).forEach(function (t) {
      const li = document.createElement('li');
      li.textContent = t;
      scoreStrengthsEl.appendChild(li);
    });

    scorePathEl.innerHTML = '';
    (ins.pathToTen || []).forEach(function (t) {
      const li = document.createElement('li');
      li.textContent = t;
      scorePathEl.appendChild(li);
    });

    if (scoreResidualEl) {
      const r = ins.residualNote;
      if (r && String(r).trim()) {
        scoreResidualEl.textContent = r;
        scoreResidualEl.hidden = false;
        scoreResidualEl.classList.remove('mc-hidden');
      } else {
        scoreResidualEl.textContent = '';
        scoreResidualEl.hidden = true;
        scoreResidualEl.classList.add('mc-hidden');
      }
    }
  }

  function renderRewriteSection(payload) {
    const code = payload.improvedCode;
    const summary = payload.rewriteSummary;
    const amends = Array.isArray(payload.rewriteAmends) ? payload.rewriteAmends : [];
    const cross = Array.isArray(payload.crossFileImpacts) ? payload.crossFileImpacts : [];

    if (summary && String(summary).trim()) {
      rewriteSummaryEl.textContent = summary;
      rewriteSummaryEl.hidden = false;
      rewriteSummaryEl.classList.remove('mc-hidden');
    } else {
      rewriteSummaryEl.textContent = '';
      rewriteSummaryEl.hidden = true;
      rewriteSummaryEl.classList.add('mc-hidden');
    }

    rewriteAmendsEl.innerHTML = '';
    if (amends.length > 0) {
      rewriteAmendsEl.hidden = false;
      rewriteAmendsEl.classList.remove('mc-hidden');
      amends.forEach(function (a, i) {
        rewriteAmendsEl.appendChild(renderAmendItem(a, i));
      });
    } else {
      rewriteAmendsEl.hidden = true;
      rewriteAmendsEl.classList.add('mc-hidden');
    }

    crossFilePanelEl.innerHTML = '';
    if (cross.length > 0) {
      crossFilePanelEl.hidden = false;
      crossFilePanelEl.classList.remove('mc-hidden');
      const title = document.createElement('div');
      title.className = 'mc-cross-file-title';
      title.textContent = 'Other files to update';
      crossFilePanelEl.appendChild(title);
      const hint = document.createElement('p');
      hint.className = 'mc-cross-file-hint';
      hint.textContent =
        'These changes are not applied automatically. Open each file and apply manually, or run a follow-up review there.';
      crossFilePanelEl.appendChild(hint);
      cross.forEach(function (c, i) {
        crossFilePanelEl.appendChild(renderCrossFileCard(c, i));
      });
    } else {
      crossFilePanelEl.hidden = true;
      crossFilePanelEl.classList.add('mc-hidden');
    }

    if (code && String(code).trim()) {
      renderHighlightedLines(rewriteLinesEl, code, amends);
    } else {
      rewriteLinesEl.textContent = '—';
      rewriteLinesEl.className = 'mc-rewrite-lines mc-code-block';
    }

    if (cross.length > 0 && code && String(code).trim()) {
      rewriteApplyNoteEl.textContent =
        'Apply improved code only updates this file. See “Other files to update” for companion edits.';
      rewriteApplyNoteEl.hidden = false;
      rewriteApplyNoteEl.classList.remove('mc-hidden');
    } else if (cross.length > 0 && (!code || !String(code).trim())) {
      rewriteApplyNoteEl.textContent =
        'No full-file rewrite for the active editor. Address the items below in the paths shown.';
      rewriteApplyNoteEl.hidden = false;
      rewriteApplyNoteEl.classList.remove('mc-hidden');
    } else {
      rewriteApplyNoteEl.textContent = '';
      rewriteApplyNoteEl.hidden = true;
      rewriteApplyNoteEl.classList.add('mc-hidden');
    }
  }

  function renderAmendItem(a, index) {
    const li = document.createElement('li');
    li.className = 'mc-amend-item';
    li.setAttribute('role', 'listitem');
    const head = document.createElement('div');
    head.className = 'mc-amend-head';
    const range = document.createElement('span');
    range.className = 'mc-amend-range';
    const s = Number(a.startLine);
    const e = Number(a.endLine);
    range.textContent =
      !isNaN(s) && !isNaN(e) ? 'Lines ' + s + '–' + e : 'Lines (see code)';
    const lab = document.createElement('span');
    lab.className = 'mc-amend-label';
    lab.textContent = a.label ? String(a.label) : 'Amend ' + (index + 1);
    head.appendChild(range);
    head.appendChild(lab);
    const why = document.createElement('p');
    why.className = 'mc-amend-rationale';
    why.textContent = a.rationale ? String(a.rationale) : '';
    li.appendChild(head);
    li.appendChild(why);
    return li;
  }

  function renderCrossFileCard(c) {
    const card = document.createElement('article');
    card.className = 'mc-cross-file-card';
    const path = document.createElement('div');
    path.className = 'mc-cross-file-path';
    path.textContent = c.path ? String(c.path) : '(unknown path)';
    const why = document.createElement('p');
    why.className = 'mc-cross-file-why';
    why.textContent = c.rationale ? String(c.rationale) : '';
    card.appendChild(path);
    card.appendChild(why);
    if (c.suggestedChange && String(c.suggestedChange).trim()) {
      const pre = document.createElement('pre');
      pre.className = 'mc-cross-file-snippet';
      pre.textContent = String(c.suggestedChange);
      card.appendChild(pre);
    }
    return card;
  }

  function lineIsAmended(lineNo, amends) {
    for (let i = 0; i < amends.length; i++) {
      const a = amends[i];
      const s = Number(a.startLine);
      const e = Number(a.endLine);
      if (!isNaN(s) && !isNaN(e) && lineNo >= s && lineNo <= e) {
        return true;
      }
    }
    return false;
  }

  function renderHighlightedLines(container, source, amends) {
    container.innerHTML = '';
    container.className = 'mc-rewrite-lines mc-code-block mc-rewrite-lines--numbered';
    const lines = source.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const row = document.createElement('div');
      row.className = 'mc-code-row';
      if (lineIsAmended(lineNo, amends)) {
        row.classList.add('mc-code-row--amend');
        row.title = 'Suggested change in this line range';
      }
      const gutter = document.createElement('span');
      gutter.className = 'mc-code-gutter';
      gutter.textContent = String(lineNo);
      const text = document.createElement('span');
      text.className = 'mc-code-text';
      text.textContent = lines[i];
      row.appendChild(gutter);
      row.appendChild(text);
      container.appendChild(row);
    }
  }

  function renderFinding(f, index) {
    const li = document.createElement('li');
    li.className = 'mc-finding';
    li.setAttribute('role', 'listitem');

    const article = document.createElement('article');
    article.className = 'mc-finding-card';
    article.setAttribute('aria-label', 'Finding ' + (index + 1));

    const sev = (f.severity || 'info').toLowerCase();
    const head = document.createElement('header');
    head.className = 'mc-finding-top';

    const badge = document.createElement('span');
    badge.className = 'mc-sev mc-sev-' + sev;
    badge.textContent = sev;

    const title = document.createElement('h3');
    title.className = 'mc-finding-title';
    title.textContent = f.message || '';

    head.appendChild(badge);
    head.appendChild(title);
    article.appendChild(head);

    const bits = [];
    if (f.category) {
      bits.push(f.category);
    }
    if (f.code) {
      bits.push(f.code);
    }
    if (bits.length) {
      const meta = document.createElement('div');
      meta.className = 'mc-finding-meta';
      meta.textContent = bits.join(' · ');
      article.appendChild(meta);
    }

    if (f.sideEffectSignal) {
      article.appendChild(sideEffectBlock(f.sideEffectSignal));
    }

    if (f.whyItMatters) {
      var whyHeading = sev === 'critical'
        ? 'Why this is critical'
        : sev === 'error'
          ? 'Why this matters'
          : 'Why it matters';
      article.appendChild(subBlock(whyHeading, f.whyItMatters, false));
    }

    if (f.teachingGap) {
      article.appendChild(teachingGapBlock(f.teachingGap));
    }

    if (f.fixHint) {
      article.appendChild(subBlock('Suggested fix', f.fixHint, true));
    }

    li.appendChild(article);
    return li;
  }

  function sideEffectBlock(signal) {
    var block = document.createElement('section');
    block.className = 'mc-sub mc-sub-side-effect';
    var h = document.createElement('h4');
    h.className = 'mc-sub-title';
    h.textContent = 'Hidden side effect';
    var p = document.createElement('p');
    p.className = 'mc-sub-copy';
    var tag = document.createElement('span');
    tag.className = 'mc-side-effect-tag';
    tag.textContent = signal;
    p.appendChild(tag);
    p.appendChild(document.createTextNode(' — read the snippet carefully; the visible code understates what runs.'));
    block.appendChild(h);
    block.appendChild(p);
    return block;
  }

  function teachingGapBlock(text) {
    var block = document.createElement('section');
    block.className = 'mc-sub mc-sub-teaching-gap';
    var h = document.createElement('h4');
    h.className = 'mc-sub-title';
    h.textContent = 'Reviewer note';
    var p = document.createElement('p');
    p.className = 'mc-sub-copy';
    p.textContent = text;
    block.appendChild(h);
    block.appendChild(p);
    return block;
  }

  function subBlock(heading, text, isFix) {
    const block = document.createElement('section');
    block.className = 'mc-sub' + (isFix ? ' mc-sub-fix' : '');
    const h = document.createElement('h4');
    h.className = 'mc-sub-title';
    h.textContent = heading;
    const p = document.createElement('p');
    p.className = 'mc-sub-copy';
    p.textContent = text;
    block.appendChild(h);
    block.appendChild(p);
    return block;
  }

  function normaliseScore(raw) {
    if (typeof raw !== 'number' || isNaN(raw)) {
      return null;
    }
    if (raw < 0 || raw > 10) {
      return null;
    }
    return Math.round(raw * 100) / 100;
  }

  function formatScore(n) {
    if (n % 1 === 0) {
      return String(Math.round(n));
    }
    return String(Number(n.toFixed(2)));
  }

  function scoreBandClass(n) {
    if (n >= 8.5) {
      return 'is-excellent';
    }
    if (n >= 6.5) {
      return 'is-good';
    }
    if (n >= 4.5) {
      return 'is-mixed';
    }
    return 'is-poor';
  }

  // ------------------------------------------------------------------
  // Multi-level review buttons
  // ------------------------------------------------------------------

  /**
   * The host sends `reviewLevels` once after the webview loads. Rendering from
   * that payload (rather than hardcoding ids here) means a new level added in
   * the domain layer automatically appears in the sidebar.
   */
  function renderLevelButtons(levels) {
    if (!reviewLevelsEl) {
      return;
    }
    reviewLevelsEl.innerHTML = '';
    if (!levels || levels.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'mc-empty';
      empty.textContent = 'No review levels available.';
      reviewLevelsEl.appendChild(empty);
      return;
    }
    levels.forEach(function (level) {
      if (!level || typeof level.id !== 'string') {
        return;
      }
      reviewLevelsEl.appendChild(renderLevelButton(level));
    });
  }

  function renderLevelButton(level) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mc-level-btn';
    btn.dataset.levelId = level.id;
    btn.setAttribute('aria-label', String(level.title || level.id));
    btn.title = String(level.tagline || '');

    const title = document.createElement('span');
    title.className = 'mc-level-btn-title';
    title.textContent = String(level.title || level.id);

    const tagline = document.createElement('span');
    tagline.className = 'mc-level-btn-tagline';
    tagline.textContent = String(level.tagline || '');

    btn.appendChild(title);
    btn.appendChild(tagline);

    btn.addEventListener('click', function () {
      if (pendingLevelId || inFlightLevelId) {
        return;
      }
      pendingLevelId = level.id;
      refreshLevelButtons();
      armLevelWatchdog();
      vscode.postMessage({ type: 'runReviewLevel', levelId: level.id });
    });
    return btn;
  }

  /**
   * Applies pending / in-flight visual state to every level button.
   * "Reviewing…" (is-loading) only when the host has confirmed running.
   */
  function refreshLevelButtons() {
    if (!reviewLevelsEl) {
      return;
    }
    const busyId = inFlightLevelId || pendingLevelId;
    const btns = reviewLevelsEl.querySelectorAll('.mc-level-btn');
    btns.forEach(function (b) {
      const isInFlight = inFlightLevelId && b.dataset.levelId === inFlightLevelId;
      const isPending = !inFlightLevelId && pendingLevelId && b.dataset.levelId === pendingLevelId;
      const isOtherBusy = busyId && b.dataset.levelId !== busyId;
      b.disabled = Boolean(busyId);
      b.classList.toggle('is-loading', Boolean(isInFlight));
      b.classList.toggle('is-pending', Boolean(isPending));
      b.classList.toggle('is-dimmed', Boolean(isOtherBusy));
    });
  }

  function scoreCaptionFor(n, stackLine) {
    const s = (stackLine || '').toLowerCase();
    const jsFamily =
      s.includes('typescript') ||
      s.includes('javascript') ||
      s.includes('react') ||
      s.includes('vue') ||
      s.includes('vite') ||
      s.includes('inertia');

    if (n >= 8.5) {
      if (jsFamily) {
        return 'Strong front-end hygiene for this scope.';
      }
      return 'Strong quality for this scope.';
    }
    if (n >= 6.5) {
      return 'Solid, with a few improvements worth taking.';
    }
    if (n >= 4.5) {
      return 'Review findings before merge.';
    }
    return 'High risk: address critical items first.';
  }
})();
