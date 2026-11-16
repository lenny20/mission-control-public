// Markdown rendered as a clean page. Any HTML in the file is sanitised, so a
// downloaded or generated file can't run scripts in the dashboard.

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';
import { href } from '../lib/router.ts';

/** `---` settings at the top of a file, shown as a small table rather than text. */
export function splitFrontMatter(text: string): { meta: [string, string][]; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: [], body: text };
  const meta = m[1]!
    .split(/\r?\n/)
    .map((l) => l.match(/^([\w-]+):\s*(.*)$/))
    .filter((x): x is RegExpMatchArray => !!x)
    .map((x) => [x[1]!, x[2]!.replace(/^["'](.*)["']$/, '$1')] as [string, string]);
  return { meta, body: text.slice(m[0].length) };
}

/**
 * Render markdown. `base` is the file's folder: relative links to other
 * documents open in the viewer, and web links open in a new tab.
 */
export function Markdown({ text, base }: { text: string; base?: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false, gfm: true, breaks: false });
    const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button'], FORBID_ATTR: ['style'] });
    const doc = new DOMParser().parseFromString(clean, 'text/html');
    // Headings get ids, so a contents list's "#section" links can jump to them.
    const used = new Set<string>();
    for (const h of doc.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      let id = slug(h.textContent ?? '');
      for (let n = 1; used.has(id); n++) id = `${slug(h.textContent ?? '')}-${n}`;
      used.add(id);
      h.id = `md-${id}`;
    }
    // The folder as a file URL, each part encoded, so names with %, # or ? resolve correctly.
    const baseUrl = base ? `file://${base.split('/').map(encodeURIComponent).join('/').replace(/\/?$/, '/')}` : null;
    for (const a of doc.querySelectorAll('a[href]')) {
      const url = a.getAttribute('href')!;
      if (/^https?:/i.test(url)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noreferrer');
      } else if (url.startsWith('#')) {
        // Kept off the hash, which is the dashboard's own address; handled by the click below.
        a.setAttribute('data-anchor', `md-${slug(decodeSafe(url.slice(1)))}`);
        a.setAttribute('href', `#md-${slug(decodeSafe(url.slice(1)))}`);
      } else if (baseUrl && !/^[a-z]+:/i.test(url)) {
        try {
          const target = decodeURIComponent(new URL(url, baseUrl).pathname);
          a.setAttribute('href', href({ area: 'notes', tab: 'view', param: target }));
        } catch {
          a.removeAttribute('href');
        }
      }
    }
    // Pictures beside the file can't be shown from here; web pictures can.
    for (const img of doc.querySelectorAll('img')) if (!/^https?:/i.test(img.getAttribute('src') ?? '')) img.replaceWith(doc.createTextNode(`[image: ${img.getAttribute('alt') || img.getAttribute('src')}]`));
    return doc.body.innerHTML;
  }, [text, base]);
  return (
    <div
      className="prose"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as Element).closest('a[data-anchor]');
        if (!a) return;
        e.preventDefault();
        document.getElementById(a.getAttribute('data-anchor')!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
    />
  );
}

/** GitHub's heading ids: lower case, punctuation dropped, spaces to hyphens. */
const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

const decodeSafe = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
