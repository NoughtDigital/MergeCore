/** Minimal markdown → HTML for the read-only explanation panel (no vscode). */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMd(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label: string, href: string) => {
      const safeHref = escapeHtml(href);
      return `<a href="${safeHref}" data-href="${safeHref}">${label}</a>`;
    }
  );
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
  return s;
}

export function markdownToSafeHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let inList = false;

  const closeList = (): void => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const raw of lines) {
    if (raw.startsWith('```')) {
      if (inCode) {
        out.push('</code></pre>');
        inCode = false;
      } else {
        closeList();
        out.push('<pre><code>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(raw) + '\n');
      continue;
    }

    if (/^>\s*/.test(raw)) {
      closeList();
      const body = raw.replace(/^>\s*/, '');
      out.push(`<blockquote>${inlineMd(body)}</blockquote>`);
      continue;
    }

    if (/^#{1,3}\s+/.test(raw)) {
      closeList();
      const level = raw.match(/^(#{1,3})/)?.[1]?.length ?? 1;
      const text = raw.replace(/^#{1,3}\s+/, '');
      out.push(`<h${level}>${inlineMd(text)}</h${level}>`);
      continue;
    }

    if (/^[-*]\s+/.test(raw)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineMd(raw.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    if (raw.trim() === '' || raw.trim() === '---') {
      closeList();
      if (raw.trim() === '---') out.push('<hr/>');
      continue;
    }

    closeList();
    out.push(`<p>${inlineMd(raw)}</p>`);
  }
  closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}
