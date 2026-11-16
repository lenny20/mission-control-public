// Text out of each kind of document, for the search index and the viewer.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import * as Y from 'yjs';
import { EXT_KINDS, type DocContent, type ScriptLine } from '../../shared/docs/types.ts';

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

// ------------------------------------------------------------------ screenplays

/** Final Draft: <Paragraph Type="Scene Heading"><Text>...</Text></Paragraph>. */
function fdx(xml: string): { title: string | null; lines: ScriptLine[] } {
  const lines: ScriptLine[] = [];
  const content = xml.match(/<Content>([\s\S]*?)<\/Content>/)?.[1] ?? xml;
  for (const m of content.matchAll(/<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/g)) {
    const type = m[1]!.match(/Type="([^"]*)"/)?.[1] ?? 'Action';
    const align = m[1]!.match(/Alignment="(Center|Right)"/)?.[1]?.toLowerCase() as ScriptLine['align'];
    const text = decodeXml([...m[2]!.matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)].map((t) => t[1]!).join(''));
    lines.push({ type: FDX_TYPES[type] ?? 'action', text: text.trim(), ...(align ? { align } : {}) });
  }
  return { title: null, lines: trimBlank(lines) };
}

const FDX_TYPES: Record<string, string> = {
  'Scene Heading': 'sceneHeading',
  Action: 'action',
  Character: 'character',
  Parenthetical: 'parenthetical',
  Dialogue: 'dialogue',
  Transition: 'transition',
  Shot: 'shot',
  General: 'action',
};

/** Sotto: JSON around a Yjs document whose 'default' fragment holds one element per line. */
function sotto(json: string): { title: string | null; lines: ScriptLine[] } {
  const file = JSON.parse(json) as { format?: string; yjsState?: string; metadata?: { title?: string } };
  if (file.format !== 'sotto' || typeof file.yjsState !== 'string') throw new Error('Not a Sotto file.');
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, Buffer.from(file.yjsState, 'base64'));
    const lines: ScriptLine[] = [];
    doc.getXmlFragment('default').forEach((node) => {
      if (node instanceof Y.XmlElement) lines.push({ type: node.nodeName, text: textOf(node) });
    });
    return { title: file.metadata?.title || null, lines };
  } finally {
    doc.destroy();
  }
}

function textOf(el: Y.XmlElement): string {
  let out = '';
  el.forEach((child) => {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as { insert?: unknown }[]) if (typeof op.insert === 'string') out += op.insert;
    } else if (child instanceof Y.XmlElement) out += textOf(child);
  });
  return out;
}

/** Fountain, the plain-text screenplay format: just enough to lay it out like a script. */
export function fountain(text: string): { title: string | null; lines: ScriptLine[] } {
  let body = text.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\[[\s\S]*?\]\]/g, '');
  let title: string | null = null;
  // A title page is "Key: value" lines before the first blank line.
  const first = body.split('\n\n')[0]!;
  if (/^[A-Za-z ]+:/m.test(first.split('\n')[0] ?? '') && first.split('\n').every((l) => /^([A-Za-z ]+:|\s)/.test(l))) {
    title = first.match(/^Title:\s*(.*)$/im)?.[1]?.trim() || null;
    body = body.slice(first.length);
  }
  const lines: ScriptLine[] = [];
  const raw = body.split('\n');
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]!;
    const t = line.trim();
    const prevBlank = i === 0 || raw[i - 1]!.trim() === '';
    const nextBlank = i === raw.length - 1 || raw[i + 1]!.trim() === '';
    if (!t) {
      continue;
    }
    if (prevBlank && nextBlank && (/^(INT|EXT|EST|INT\.?\/EXT|I\/E)[ .]/i.test(t) || /^\.[^.]/.test(t))) {
      lines.push({ type: 'sceneHeading', text: t.replace(/^\./, '') });
    } else if (prevBlank && nextBlank && (/^[A-Z0-9 .'-]+ TO:$/.test(t) || t.startsWith('>')) && !t.endsWith('<')) {
      lines.push({ type: 'transition', text: t.replace(/^>\s*/, '') });
    } else if (prevBlank && !nextBlank && (/^[A-Z0-9 .'()\-]+(\^)?$/.test(t) && /[A-Z]/.test(t) || t.startsWith('@'))) {
      lines.push({ type: 'character', text: t.replace(/^@/, '').replace(/\s*\^$/, '') });
      // Dialogue and parentheticals follow until a blank line.
      while (i + 1 < raw.length && raw[i + 1]!.trim()) {
        const d = raw[++i]!.trim();
        lines.push({ type: /^\(.*\)$/.test(d) ? 'parenthetical' : 'dialogue', text: d });
      }
    } else if (/^#+\s/.test(t)) {
      lines.push({ type: 'actHeading', text: t.replace(/^#+\s*/, '') });
    } else if (/^=\s/.test(t) || t === '===') {
      continue;
    } else {
      lines.push({ type: 'action', text: t.replace(/^!/, '').replace(/^>\s*(.*?)\s*<$/, '$1') });
    }
  }
  return { title, lines };
}

const trimBlank = (lines: ScriptLine[]) => {
  const out = [...lines];
  while (out.length && !out[0]!.text) out.shift();
  while (out.length && !out.at(-1)!.text) out.pop();
  return out;
};

// ------------------------------------------------------------------ Word and PDF

function docx(buf: Buffer): { style: string | null; text: string }[] {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => f.name === 'word/document.xml' });
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('Not a Word document.');
  const out: { style: string | null; text: string }[] = [];
  for (const p of strFromU8(xml).matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const style = p[1]!.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? null;
    const text = decodeXml(
      p[1]!
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<w:br\/>/g, '\n')
        .match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|\t|\n/g)
        ?.map((t) => t.replace(/<[^>]+>/g, ''))
        .join('') ?? '',
    );
    out.push({ style, text });
  }
  return out;
}

async function pdf(buf: Buffer): Promise<{ pages: number; text: string }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(buf), verbosity: 0 });
  const doc = await task.promise;
  try {
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      for (const item of content.items) if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '');
      text += '\n\n';
    }
    return { pages: doc.numPages, text: text.trim() };
  } finally {
    await task.destroy();
  }
}

// ------------------------------------------------------------------ entry points

export const kindOf = (file: string) => EXT_KINDS[path.extname(file).toLowerCase()] ?? null;

/** The file's content in the shape the viewer shows. */
export async function readDoc(file: string): Promise<DocContent> {
  const ext = path.extname(file).toLowerCase();
  const buf = readFileSync(file);
  switch (ext) {
    case '.md':
    case '.markdown':
      return { type: 'markdown', text: buf.toString('utf8') };
    case '.txt':
      return { type: 'text', text: buf.toString('utf8') };
    case '.fdx':
      return { type: 'script', ...fdx(buf.toString('utf8')) };
    case '.fountain':
      return { type: 'script', ...fountain(buf.toString('utf8')) };
    case '.sotto':
      return { type: 'script', ...sotto(buf.toString('utf8')) };
    case '.docx':
      return { type: 'word', paragraphs: docx(buf) };
    case '.pdf':
      return { type: 'pdf', ...(await pdf(buf)) };
    default:
      throw new Error(`Can't read ${ext} files.`);
  }
}

/** A markdown file's leading --- block of settings (title, tags...), which isn't its text. */
export const stripFrontMatter = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

/** Plain text for the search index. */
export function plainText(c: DocContent): string {
  switch (c.type) {
    case 'markdown':
      return stripFrontMatter(c.text);
    case 'text':
    case 'pdf':
      return c.text;
    case 'script':
      return [c.title, ...c.lines.map((l) => l.text)].filter(Boolean).join('\n');
    case 'word':
      return c.paragraphs.map((p) => p.text).join('\n');
  }
}
