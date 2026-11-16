// The document search index: its own SQLite file (data/search.db), separate
// from the main database, so it can be deleted and rebuilt at any time.
//
// A full pass walks the places in settings, skipping hidden folders,
// node_modules, build output, git-ignored files and the exclude list, and
// re-reads only files whose size or modified time changed. The server runs
// passes in a child process (run-index.ts) so searching never waits on it.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DocFile, DocKind, IndexStatus, SearchHit } from '../../shared/docs/types.ts';
import { expandHome } from '../config.ts';
import { kindOf, plainText, readDoc } from './extract.ts';

export type SearchDb = DatabaseSync;

export function openSearch(file: string): SearchDb {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS files (
      path      TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      kind      TEXT NOT NULL,
      size      INTEGER NOT NULL,
      mtime     REAL NOT NULL,
      error     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(kind, mtime);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(path UNINDEXED, name, body, tokenize = 'unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  return db;
}

// ------------------------------------------------------------------ what gets indexed

/** Folders never worth searching, wherever they are. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'coverage', '__pycache__', 'venv', 'bower_components', 'vendor', 'Pods', 'DerivedData']);
/** Bigger than this, only the name is searched. */
const MAX_BYTES: Record<DocKind, number> = { markdown: 4e6, text: 4e6, script: 8e6, word: 30e6, pdf: 60e6 };

export type Places = { roots: string[]; exclude: string[]; home?: string };

const hidden = (rel: string) => rel.split(path.sep).some((part) => part.startsWith('.'));

function excluded(rel: string, exclude: string[]): boolean {
  const parts = rel.split(path.sep);
  return exclude.some((x) => (x.includes('/') ? rel === x || rel.startsWith(`${x}/`) || rel.includes(`/${x}/`) : parts.includes(x)));
}

/** Files git would track in a repo: tracked plus untracked-but-not-ignored. */
function gitFiles(repo: string): string[] | null {
  try {
    const out = execFileSync('git', ['-C', repo, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 256e6, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

/** Every searchable file under the places, as absolute paths. */
export function listFiles({ roots, exclude: raw, home = os.homedir() }: Places): string[] {
  const exclude = raw.map((x) => x.replace(/^~\//, '').replace(/\/+$/, '')).filter(Boolean);
  const out = new Set<string>();
  const add = (abs: string) => {
    const rel = path.relative(home, abs);
    if (kindOf(abs) && !hidden(rel) && !excluded(rel, exclude) && !rel.split(path.sep).some((p) => SKIP_DIRS.has(p))) out.add(abs);
  };
  const walk = (dir: string) => {
    if (existsSync(path.join(dir, '.git'))) {
      const files = gitFiles(dir);
      if (files) {
        for (const f of files) {
          const abs = path.join(dir, f);
          // git lists a repo nested inside this one as "inner/": walk it on its own terms.
          if (f.endsWith('/')) {
            if (!f.split('/').some((p) => p.startsWith('.') || SKIP_DIRS.has(p)) && !excluded(path.relative(home, abs), exclude)) walk(abs.replace(/\/$/, ''));
            continue;
          }
          try {
            if (lstatSync(abs).isSymbolicLink()) continue;
          } catch {
            continue;
          }
          add(abs);
        }
        return;
      }
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !excluded(path.relative(home, abs), exclude)) walk(abs);
      } else if (e.isFile()) add(abs);
    }
  };
  for (const r of roots) {
    const root = expandHome(r);
    if (!existsSync(root)) continue;
    if (path.resolve(root) === path.resolve(home)) {
      // The home folder itself: loose files only, never everything below it.
      for (const e of readdirSync(home, { withFileTypes: true })) if (e.isFile() && !e.name.startsWith('.')) add(path.join(home, e.name));
    } else walk(root);
  }
  return [...out];
}

// ------------------------------------------------------------------ indexing

/** Read one file into the index. Returns false if it couldn't be read (the name is still searchable). */
export async function indexFile(db: SearchDb, file: string, st = statSync(file)): Promise<boolean> {
  const kind = kindOf(file)!;
  let body = '';
  let error: string | null = null;
  if (st.size <= MAX_BYTES[kind]) {
    try {
      body = plainText(await readDoc(file));
    } catch (err) {
      error = (err as Error).message.slice(0, 300);
    }
  } else error = 'Too big to read; only the name is searched.';
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM fts WHERE path = ?').run(file);
    db.prepare('INSERT INTO fts (path, name, body) VALUES (?, ?, ?)').run(file, path.basename(file), body);
    db.prepare('INSERT OR REPLACE INTO files (path, name, kind, size, mtime, error) VALUES (?, ?, ?, ?, ?, ?)').run(file, path.basename(file), kind, st.size, st.mtimeMs, error);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return !error;
}

export function forgetFile(db: SearchDb, file: string) {
  db.prepare('DELETE FROM fts WHERE path = ?').run(file);
  db.prepare('DELETE FROM files WHERE path = ?').run(file);
}

/** One full pass. Returns how many files were read, kept and dropped. */
export async function indexAll(db: SearchDb, places: Places, log: (msg: string) => void = () => {}) {
  const started = Date.now();
  setMeta(db, 'running', new Date().toISOString());
  try {
    const files = listFiles(places);
    const known = new Map((db.prepare('SELECT path, size, mtime FROM files').all() as { path: string; size: number; mtime: number }[]).map((r) => [r.path, r]));
    let read = 0;
    for (const f of files) {
      let st;
      try {
        st = statSync(f);
      } catch {
        continue;
      }
      const k = known.get(f);
      known.delete(f);
      if (k && k.size === st.size && k.mtime === st.mtimeMs) continue;
      await indexFile(db, f, st);
      read++;
    }
    for (const gone of known.keys()) forgetFile(db, gone);
    setMeta(db, 'lastRun', new Date().toISOString());
    setMeta(db, 'error', null);
    log(`Indexed ${files.length} files (${read} read, ${known.size} removed) in ${Date.now() - started} ms`);
    return { total: files.length, read, removed: known.size };
  } catch (err) {
    setMeta(db, 'error', (err as Error).message);
    throw err;
  } finally {
    setMeta(db, 'running', null);
  }
}

const setMeta = (db: SearchDb, key: string, value: string | null) =>
  value == null ? db.prepare('DELETE FROM meta WHERE key = ?').run(key) : db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
const getMeta = (db: SearchDb, key: string) => (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;

export function indexStatus(db: SearchDb, places: Places): IndexStatus {
  const running = getMeta(db, 'running');
  return {
    files: (db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n,
    lastRun: getMeta(db, 'lastRun'),
    // A pass that died leaves its mark; after an hour it's not running any more.
    running: !!running && Date.now() - Date.parse(running) < 3_600_000,
    error: getMeta(db, 'error'),
    roots: places.roots,
    exclude: places.exclude,
  };
}

// ------------------------------------------------------------------ queries

const home = os.homedir();
export const displayPath = (p: string) => (p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);

function toDocFile(r: { path: string; name: string; kind: string; size: number; mtime: number }): DocFile {
  return { path: r.path, display: displayPath(r.path), name: r.name, kind: r.kind as DocKind, size: r.size, modified: new Date(r.mtime).toISOString() };
}

/** Words become prefix matches that must all appear; quotes keep a phrase together. */
export function ftsQuery(raw: string): string | null {
  const q = raw.replace(/[\u0000-\u001f]/g, ' ');
  const terms = [...q.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]!).replace(/"/g, '').trim()).filter(Boolean);
  if (!terms.length) return null;
  return terms.map((t, i) => (i === terms.length - 1 && !q.trimEnd().endsWith('"') ? `"${t}"*` : `"${t}"`)).join(' ');
}

export function search(db: SearchDb, q: string, kind: DocKind | null, limit = 50): SearchHit[] {
  const match = ftsQuery(q);
  if (!match) return [];
  // Name matches count for more than body matches.
  const rows = db
    .prepare(
      `SELECT f.path, f.name, f.kind, f.size, f.mtime,
              snippet(fts, 2, char(2), char(3), '…', 24) AS snippet,
              (SELECT count(*) FROM fts n WHERE n.path = fts.path AND n.name MATCH ?) AS name_match
         FROM fts JOIN files f ON f.path = fts.path
        WHERE fts MATCH ? ${kind ? 'AND f.kind = ?' : ''}
        ORDER BY name_match DESC, bm25(fts, 0, 8, 1)
        LIMIT ?`,
    )
    .all(...([match, match, ...(kind ? [kind] : []), limit] as [string, string, ...(string | number)[]])) as { path: string; name: string; kind: string; size: number; mtime: number; snippet: string; name_match: number }[];
  return rows.map((r) => ({ ...toDocFile(r), snippet: r.snippet.includes('\u0002') ? r.snippet : null, nameMatch: r.name_match > 0 }));
}

/** The newest markdown files: plans, specs and notes as they're written. */
export function recent(db: SearchDb, limit = 40): DocFile[] {
  return (db.prepare("SELECT path, name, kind, size, mtime FROM files WHERE kind = 'markdown' ORDER BY mtime DESC LIMIT ?").all(limit) as Parameters<typeof toDocFile>[0][]).map(toDocFile);
}

/**
 * Whether the viewer may open a file: a kind it reads, inside the home folder,
 * and not in a hidden folder (where keys and settings live). Returns the real path.
 */
export function viewablePath(p: string, homeDir = home): string | null {
  const abs = path.resolve(expandHome(p));
  let real: string;
  try {
    real = realpathSync(abs);
    if (!lstatSync(real).isFile()) return null;
  } catch {
    return null;
  }
  const rel = path.relative(homeDir, real);
  if (rel.startsWith('..') || path.isAbsolute(rel) || hidden(rel) || !kindOf(real)) return null;
  return real;
}
