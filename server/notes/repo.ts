// Ideas, saved links and notes. Notes are plain markdown files in a folder
// (readable in Obsidian or any editor); ideas and links live in the database.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { today as todayIn, type DateStr } from '../../shared/dates.ts';
import { docsSettings, ideaInput, ideaSort, linkInput, linkPatch, noteInput, notePatch } from '../../shared/docs/schemas.ts';
import type { Idea, Note, NoteSummary, NotesSnapshot, SavedLink } from '../../shared/docs/types.ts';
import { getSetting, setSetting } from '../calendar/repo.ts';
import { config, expandHome, paths } from '../config.ts';
import { transaction, type Db } from '../db.ts';
import { UserError } from '../errors.ts';
import * as work from '../work/repo.ts';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const now = () => new Date().toISOString();

// ------------------------------------------------------------------ settings

const DEFAULT_NOTES_DIR = '~/Documents/Mission Control/Notes';
const DEFAULT_ROOTS: string[] = [];
const DEFAULT_EXCLUDE: string[] = [];

export const notesDir = (db: Db) => getSetting(db, 'notes.dir') ?? DEFAULT_NOTES_DIR;

/** Where doc search looks. The notes folder is always included. */
export function docPlaces(db: Db) {
  const roots = JSON.parse(getSetting(db, 'docs.roots') ?? 'null') ?? DEFAULT_ROOTS;
  const exclude = JSON.parse(getSetting(db, 'docs.exclude') ?? 'null') ?? DEFAULT_EXCLUDE;
  return { roots: roots as string[], exclude: exclude as string[], notesDir: notesDir(db) };
}

/** Everything the search index covers: the places, the notes folder and the tax vault (which sits in the git-ignored data folder). */
export function searchPlaces(db: Db) {
  const p = docPlaces(db);
  return { roots: [...p.roots, p.notesDir, paths.vault], exclude: p.exclude };
}

export function setDocPlaces(db: Db, raw: unknown) {
  const s = docsSettings.parse(raw);
  // Skip entries are relative to the home folder: "~/Documents/Codex/" means "Documents/Codex".
  s.exclude = s.exclude.map((x) => x.replace(/^~\//, '').replace(new RegExp(`^${os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), '').replace(/\/+$/, '')).filter(Boolean);
  setSetting(db, 'docs.roots', JSON.stringify(s.roots));
  setSetting(db, 'docs.exclude', JSON.stringify(s.exclude));
  return docPlaces(db);
}

// ------------------------------------------------------------------ ideas

const rowToIdea = (r: Row): Idea => ({
  id: Number(r.id),
  text: String(r.text),
  createdAt: String(r.created_at),
  status: r.status as Idea['status'],
  outcome: str(r.outcome),
  outcomeLink: str(r.outcome_link),
});

export function listIdeas(db: Db): Idea[] {
  return (db.prepare('SELECT * FROM ideas ORDER BY id DESC').all() as Row[]).map(rowToIdea);
}

export function getIdea(db: Db, id: number): Idea {
  const r = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new UserError(`There's no idea ${id}.`, 404);
  return rowToIdea(r);
}

export function addIdea(db: Db, raw: unknown, source: 'chat' | 'dashboard'): Idea {
  const { text } = ideaInput.parse(raw);
  const { lastInsertRowid } = db.prepare('INSERT INTO ideas (text, source, created_at) VALUES (?, ?, ?)').run(text, source, now());
  return getIdea(db, Number(lastInsertRowid));
}

export function updateIdea(db: Db, id: number, raw: unknown): Idea {
  const { text } = ideaInput.parse(raw);
  getIdea(db, id);
  db.prepare('UPDATE ideas SET text = ? WHERE id = ?').run(text, id);
  return getIdea(db, id);
}

export function deleteIdea(db: Db, id: number): Idea {
  const idea = getIdea(db, id);
  db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
  return idea;
}

/** First line becomes the title; the rest, if any, the body. */
function splitIdea(text: string, max: number): { title: string; rest: string | null } {
  const [first, ...more] = text.split('\n');
  let title = first!.trim();
  let rest = more.join('\n').trim();
  if (title.length > max) {
    rest = text;
    title = `${title.slice(0, max - 1).trimEnd()}…`;
  }
  return { title, rest: rest || null };
}

/**
 * Sort an idea out of the inbox: into a new board card, a new note, or the
 * archive. The idea is kept, marked with where it went.
 * `addWatch` is the watchlist's own add, passed in so this module doesn't depend on it.
 */
export function sortIdea(db: Db, id: number, raw: unknown, today: DateStr, addWatch?: (title: string) => { outcome: string; link: string }, source: 'chat' | 'dashboard' = 'dashboard'): Idea {
  const target = ideaSort.parse(raw);
  const idea = getIdea(db, id);
  if (target.to !== 'inbox' && idea.status === 'sorted') throw new UserError(`That idea was already sorted: ${idea.outcome}.`);
  return transaction(db, () => {
    const mark = (status: Idea['status'], outcome: string | null, link: string | null) =>
      db.prepare('UPDATE ideas SET status = ?, outcome = ?, outcome_link = ?, sorted_at = ? WHERE id = ?').run(status, outcome, link, status === 'inbox' ? null : now(), id);
    switch (target.to) {
      case 'card': {
        const { title, rest } = splitIdea(idea.text, 300);
        const card = work.createCard(db, { board: target.board, title, notes: rest, projectId: target.projectId }, source, today);
        mark('sorted', `card ${card.id}`, `#/work/${card.board}/${card.id}`);
        break;
      }
      case 'note': {
        const { title, rest } = splitIdea(idea.text, 120);
        // Only the title becomes a file name, so only it loses the characters a file name can't hold.
        const safe = title.replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim() || 'Idea';
        const note = createNote(db, { title: safe, body: rest ?? '', project: target.project });
        mark('sorted', `note ${note.file}`, `#/notes/notes/${encodeURIComponent(note.file)}`);
        break;
      }
      case 'watch': {
        if (!addWatch) throw new UserError("The watchlist isn't set up yet.");
        const w = addWatch(splitIdea(idea.text, 200).title);
        mark('sorted', w.outcome, w.link);
        break;
      }
      case 'archive':
        mark('archived', null, null);
        break;
      case 'inbox':
        if (idea.status === 'sorted') throw new UserError(`That idea became ${idea.outcome}. Delete that to start again.`);
        mark('inbox', null, null);
        break;
    }
    return getIdea(db, id);
  });
}

// ------------------------------------------------------------------ links

const rowToLink = (r: Row): SavedLink => ({ id: Number(r.id), url: String(r.url), title: str(r.title), note: str(r.note), project: str(r.project), createdAt: String(r.created_at) });

export function listLinks(db: Db): SavedLink[] {
  return (db.prepare('SELECT * FROM saved_links ORDER BY id DESC').all() as Row[]).map(rowToLink);
}

function getLink(db: Db, id: number): SavedLink {
  const r = db.prepare('SELECT * FROM saved_links WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new UserError(`There's no link ${id}.`, 404);
  return rowToLink(r);
}

export function addLink(db: Db, raw: unknown): SavedLink {
  const l = linkInput.parse(raw);
  const { lastInsertRowid } = db.prepare('INSERT INTO saved_links (url, title, note, project, created_at) VALUES (?, ?, ?, ?, ?)').run(l.url, l.title, l.note, l.project, now());
  return getLink(db, Number(lastInsertRowid));
}

export function updateLink(db: Db, id: number, raw: unknown): SavedLink {
  const l = { ...getLink(db, id), ...linkPatch.parse(raw) };
  db.prepare('UPDATE saved_links SET url = ?, title = ?, note = ?, project = ? WHERE id = ?').run(l.url, l.title, l.note, l.project, id);
  return getLink(db, id);
}

export function deleteLink(db: Db, id: number): SavedLink {
  const l = getLink(db, id);
  db.prepare('DELETE FROM saved_links WHERE id = ?').run(id);
  return l;
}

export function searchLinks(db: Db, q: string): SavedLink[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return listLinks(db).filter((l) => words.every((w) => [l.url, l.title, l.note, l.project].some((f) => f?.toLowerCase().includes(w))));
}

// ------------------------------------------------------------------ notes

/** The notes folder, made if it isn't there. */
function dir(db: Db): string {
  const d = expandHome(notesDir(db));
  mkdirSync(d, { recursive: true });
  return d;
}

/** A note's file, refusing anything outside the notes folder. */
function notePath(db: Db, file: string): string {
  const base = path.resolve(dir(db));
  const abs = path.resolve(base, file);
  const parts = path.relative(base, abs).split(path.sep);
  const refused = () => new UserError(`"${file}" isn't a note in the notes folder.`, 404);
  if (!abs.startsWith(`${base}${path.sep}`) || !abs.endsWith('.md') || parts.some((p) => p.startsWith('.'))) {
    throw refused();
  }
  // Match the note list: never follow a linked file or folder. A lexical path
  // inside the notes folder can otherwise read or overwrite a file outside it.
  let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw refused();
  }
  return abs;
}

/**
 * The --- block of settings at the top of a note, if it has one. A leading
 * horizontal rule isn't one: every line inside must look like YAML (a key,
 * a list item or an indented continuation).
 */
function frontMatter(text: string): { lines: string[]; rest: string } | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) return null;
  const lines = m[1]!.split(/\r?\n/);
  if (!lines.every((l) => !l.trim() || /^[\w-]+:/.test(l) || /^\s/.test(l) || /^-\s/.test(l) || l.startsWith('#'))) return null;
  return { lines, rest: text.slice(m[0].length) };
}

/** A YAML scalar as written: "quoted", 'quoted' or plain. */
function unquote(v: string): string {
  const t = v.trim();
  if (t.startsWith('"')) {
    try {
      return String(JSON.parse(t));
    } catch {
      return t.slice(1, -1);
    }
  }
  return t.startsWith("'") && t.endsWith("'") ? t.slice(1, -1).replace(/''/g, "'") : t;
}

export function parseNote(file: string, text: string, modified: string): Note {
  const fm = frontMatter(text);
  const meta: Record<string, string> = {};
  for (const line of fm?.lines ?? []) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]!.toLowerCase()] = unquote(kv[2]!);
  }
  return {
    file,
    title: meta.title || path.basename(file, '.md'),
    project: meta.project || null,
    created: meta.created && /^\d{4}-\d{2}-\d{2}$/.test(meta.created) ? meta.created : null,
    body: (fm ? fm.rest : text).replace(/^(\r?\n)+/, ''),
    modified,
  };
}

/**
 * Plain when YAML reads it back as the same text; otherwise quoted the JSON
 * way, which is valid YAML whatever it holds (colons, #, brackets, @).
 */
function yamlString(v: string): string {
  const plain = /^[\p{L}][\p{L}\p{N} _.,()'&+–—!-]*$/u.test(v) && !/^(true|false|null|yes|no|on|off|y|n)$/i.test(v) && !/\s$/.test(v);
  return plain ? v : JSON.stringify(v);
}

/**
 * The note's text with its title, project and created date set. Any other
 * settings already there (tags, aliases from Obsidian) are kept as they were.
 */
function serialise(n: Pick<Note, 'title' | 'project' | 'created' | 'body'>, existing: string | null = null): string {
  const lines = (existing != null && frontMatter(existing)?.lines) || [];
  const set = (key: string, value: string | null) => {
    const at = lines.findIndex((l) => new RegExp(`^${key}:`, 'i').test(l));
    const line = value == null ? null : `${key}: ${key === 'created' ? value : yamlString(value)}`;
    if (at === -1) {
      if (line) lines.push(line);
    } else if (line) lines[at] = line;
    else lines.splice(at, 1);
  };
  set('title', n.title);
  set('project', n.project);
  set('created', n.created);
  return `---\n${lines.join('\n')}\n---\n\n${n.body.replace(/^\n+/, '')}${n.body.endsWith('\n') ? '' : '\n'}`;
}

export function readNote(db: Db, file: string): Note {
  const abs = notePath(db, file);
  if (!existsSync(abs)) throw new UserError(`There's no note called ${file}.`, 404);
  return parseNote(file, readFileSync(abs, 'utf8'), statSync(abs).mtime.toISOString());
}

export function listNotes(db: Db): NoteSummary[] {
  const base = dir(db);
  const out: NoteSummary[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && e.name.endsWith('.md')) {
        const { body, ...n } = parseNote(path.relative(base, abs), readFileSync(abs, 'utf8'), statSync(abs).mtime.toISOString());
        out.push({ ...n, excerpt: body.replace(/[#>*_`[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160) });
      }
    }
  };
  walk(base);
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

/** A file name for a title that isn't taken: "Title.md", then "Title 2.md"... */
function freeName(db: Db, title: string, folder = '', except?: string): string {
  for (let n = 1; ; n++) {
    const file = path.join(folder, `${title}${n === 1 ? '' : ` ${n}`}.md`);
    if (file === except || !existsSync(notePath(db, file))) return file;
  }
}

export function createNote(db: Db, raw: unknown): Note {
  const input = noteInput.parse(raw);
  const file = freeName(db, input.title);
  writeFileSync(notePath(db, file), serialise({ ...input, created: todayIn(config.timeZone) }), { flag: 'wx' });
  return readNote(db, file);
}

/**
 * Change a note. A new title renames the file. If the file changed on disk
 * since the editor loaded it (another editor, or chat), nothing is saved.
 */
export function updateNote(db: Db, file: string, raw: unknown): Note {
  const patch = notePatch.parse(raw);
  const before = readNote(db, file);
  if (patch.baseModified && patch.baseModified !== before.modified) {
    throw new UserError('This note changed on disk since you opened it, so your edit wasn\'t saved. Copy your changes, reopen the note and try again.', 409);
  }
  const next = { ...before, ...patch };
  let target = file;
  if (patch.title && patch.title !== before.title) target = freeName(db, patch.title, path.dirname(file) === '.' ? '' : path.dirname(file), file);
  writeFileSync(notePath(db, file), serialise(next, readFileSync(notePath(db, file), 'utf8')));
  if (target !== file) renameSync(notePath(db, file), notePath(db, target));
  return readNote(db, target);
}

/** Notes are never destroyed: a deleted one moves to the hidden .trash folder inside the notes folder. */
export function deleteNote(db: Db, file: string): Note {
  const note = readNote(db, file);
  const trash = path.join(dir(db), '.trash');
  mkdirSync(trash, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  renameSync(notePath(db, file), path.join(trash, `${path.basename(file, '.md')} (deleted ${stamp}).md`));
  return note;
}

/** Absolute path of a note file, for the search index. */
export const noteAbsPath = (db: Db, file: string) => notePath(db, file);

// ------------------------------------------------------------------ snapshot

/** Names notes and links can be attached to: software projects and Film & TV projects. */
export function projectNames(db: Db): string[] {
  const names = [...work.listProjects(db).map((p) => p.name), ...work.listCards(db).filter((c) => c.board === 'film' && c.column !== 'shelved').map((c) => c.title)];
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export function snapshot(db: Db, today: DateStr): NotesSnapshot {
  return { today, ideas: listIdeas(db), links: listLinks(db), notes: listNotes(db), notesDir: notesDir(db), projects: projectNames(db) };
}
