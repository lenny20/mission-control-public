import { getProfile } from '../profile.ts';
// The Watchlist: films and series to watch, being watched, and watched.
// TMDB fills in posters, details and Australian streaming when it's set up;
// without it, titles are kept as typed.

import type { DateStr } from '../../shared/dates.ts';
import { watchInput, watchPatch } from '../../shared/watch/schemas.ts';
import type { TmdbHit, WatchItem, WatchSnapshot } from '../../shared/watch/types.ts';
import { transaction, type Db } from '../db.ts';
import { UserError } from '../errors.ts';
import * as work from '../work/repo.ts';
import * as omdb from './omdb.ts';
import * as tmdb from './tmdb.ts';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const now = () => new Date().toISOString();

function rowToItem(r: Row, comps: number[]): WatchItem {
  return {
    id: Number(r.id),
    kind: r.kind as WatchItem['kind'],
    title: String(r.title),
    year: num(r.year),
    tmdbId: num(r.tmdb_id),
    poster: str(r.poster),
    overview: str(r.overview),
    genres: JSON.parse(String(r.genres)) as string[],
    runtime: num(r.runtime),
    seasons: num(r.seasons),
    status: r.status as WatchItem['status'],
    rating: num(r.rating),
    note: str(r.note),
    watchedOn: str(r.watched_on),
    addedAt: String(r.added_at),
    providers: r.providers ? (JSON.parse(String(r.providers)) as WatchItem['providers']) : null,
    providersAt: str(r.providers_at),
    imdbId: str(r.imdb_id),
    scores: r.scores ? (JSON.parse(String(r.scores)) as WatchItem['scores']) : null,
    scoresAt: str(r.scores_at),
    comps,
  };
}

export function listItems(db: Db): WatchItem[] {
  const comps = new Map<number, number[]>();
  for (const c of db.prepare('SELECT item_id, card_id FROM watch_comps ORDER BY card_id').all() as { item_id: number; card_id: number }[]) {
    comps.set(c.item_id, [...(comps.get(c.item_id) ?? []), c.card_id]);
  }
  return (db.prepare('SELECT * FROM watch_items ORDER BY added_at DESC, id DESC').all() as Row[]).map((r) => rowToItem(r, comps.get(Number(r.id)) ?? []));
}

export function getItem(db: Db, id: number): WatchItem {
  const r = db.prepare('SELECT * FROM watch_items WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new UserError(`There's no watchlist item ${id}.`, 404);
  const comps = (db.prepare('SELECT card_id FROM watch_comps WHERE item_id = ? ORDER BY card_id').all(id) as { card_id: number }[]).map((c) => c.card_id);
  return rowToItem(r, comps);
}

export function addItem(db: Db, raw: unknown, source: 'chat' | 'dashboard'): WatchItem {
  const w = watchInput.parse(raw);
  if (w.tmdbId) {
    const dup = db.prepare('SELECT id, title FROM watch_items WHERE tmdb_id = ? AND kind = ?').get(w.tmdbId, w.kind) as { id: number; title: string } | undefined;
    if (dup) throw new UserError(`${dup.title} is already on the watchlist (item ${dup.id}).`, 409);
  }
  const { lastInsertRowid } = db
    .prepare('INSERT INTO watch_items (kind, title, year, tmdb_id, status, watched_on, source, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(w.kind, w.title, w.year, w.tmdbId, w.status, null, source, now());
  return getItem(db, Number(lastInsertRowid));
}

export function updateItem(db: Db, id: number, raw: unknown, today: DateStr): WatchItem {
  const patch = watchPatch.parse(raw);
  return transaction(db, () => {
    const before = getItem(db, id);
    const w = { ...before, ...patch };
    // Marking it watched dates it today unless a date was given; going back clears the date.
    if (patch.status === 'watched' && before.status !== 'watched' && patch.watchedOn === undefined) w.watchedOn = today;
    if (patch.status && patch.status !== 'watched' && patch.watchedOn === undefined) w.watchedOn = null;
    if (w.status !== 'watched' && (patch.rating != null || patch.note != null)) throw new UserError('Ratings and notes are for things already watched.');
    // A different TMDB match means the old details belong to another title.
    const rematched = patch.tmdbId !== undefined && patch.tmdbId !== before.tmdbId;
    if (rematched && w.tmdbId) {
      const dup = db.prepare('SELECT id, title FROM watch_items WHERE tmdb_id = ? AND kind = ? AND id != ?').get(w.tmdbId, w.kind, id) as { id: number; title: string } | undefined;
      if (dup) throw new UserError(`${dup.title} is already on the watchlist (item ${dup.id}).`, 409);
    }
    db.prepare(
      `UPDATE watch_items SET kind = ?, title = ?, year = ?, tmdb_id = ?, status = ?, rating = ?, note = ?, watched_on = ?
       ${rematched ? ', poster = NULL, overview = NULL, genres = \'[]\', runtime = NULL, seasons = NULL, providers = NULL, providers_at = NULL, imdb_id = NULL, scores = NULL, scores_at = NULL' : ''} WHERE id = ?`,
    ).run(w.kind, w.title, rematched && patch.year === undefined ? null : w.year, w.tmdbId, w.status, w.rating, w.note, w.watchedOn, id);
    if (patch.comps) {
      for (const cardId of patch.comps) {
        if (work.getCard(db, cardId).board !== 'film') throw new UserError('Comparison titles are for Film & TV projects.');
      }
      db.prepare('DELETE FROM watch_comps WHERE item_id = ?').run(id);
      const add = db.prepare('INSERT INTO watch_comps (item_id, card_id) VALUES (?, ?)');
      for (const cardId of new Set(patch.comps)) add.run(id, cardId);
    }
    return getItem(db, id);
  });
}

export function deleteItem(db: Db, id: number): WatchItem {
  const w = getItem(db, id);
  db.prepare('DELETE FROM watch_items WHERE id = ?').run(id);
  return w;
}

/**
 * Fill in poster, details, Australian streaming and TMDB's score from TMDB,
 * then IMDb, Rotten Tomatoes and Metacritic from OMDb when that's set up.
 * Does nothing without a match or a token. OMDb failing keeps the scores it
 * gave last time.
 */
export async function enrich(db: Db, id: number): Promise<WatchItem> {
  const w = getItem(db, id);
  if (!w.tmdbId || !tmdb.token()) return w;
  const d = await tmdb.details(w.kind, w.tmdbId, getProfile(db).watchRegion);
  const last = w.imdbId === d.imdbId ? w.scores : null;
  let fromOmdb: omdb.OmdbScores = { imdb: last?.imdb ?? null, imdbVotes: last?.imdbVotes ?? null, rottenTomatoes: last?.rottenTomatoes ?? null, metacritic: last?.metacritic ?? null };
  let scoresAt = w.imdbId === d.imdbId ? w.scoresAt : null;
  if (d.imdbId && omdb.key()) {
    try {
      fromOmdb = await omdb.scores(d.imdbId);
      scoresAt = now();
    } catch (err) {
      console.error(`Scores for ${w.title}: ${(err as Error).message}`);
    }
  }
  db.prepare(
    'UPDATE watch_items SET poster = ?, overview = ?, genres = ?, runtime = ?, seasons = ?, year = coalesce(year, ?), providers = ?, providers_at = ?, imdb_id = ?, scores = ?, scores_at = ? WHERE id = ?',
  ).run(d.poster, d.overview, JSON.stringify(d.genres), d.runtime, d.seasons, d.year, JSON.stringify(d.providers), now(), d.imdbId, JSON.stringify({ tmdb: d.score, ...fromOmdb }), scoresAt, id);
  return getItem(db, id);
}

/**
 * TMDB ranks by what's popular this week, so "The Conversation" brings up
 * "The Oprah Conversation" and a 2019 series before Coppola's film. A result
 * with exactly the title asked for (ignoring case and punctuation) wins, and
 * among those the one most people have rated; with no exact title, TMDB's first.
 */
function pick(hits: TmdbHit[], title: string): TmdbHit | null {
  const norm = (t: string) => t.toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
  const exact = hits.filter((h) => norm(h.title) === norm(title));
  return exact.reduce<TmdbHit | null>((a, h) => (!a || h.votes > a.votes ? h : a), null) ?? hits[0] ?? null;
}

/**
 * Add a title by name, matching it on TMDB when that's set up: the best
 * result of the right kind (and year, if given) wins.
 */
export async function addByName(db: Db, raw: unknown, source: 'chat' | 'dashboard'): Promise<WatchItem> {
  const w = watchInput.parse(raw);
  // "As typed" means exactly that: no TMDB match.
  const match = (raw as { match?: unknown }).match !== false;
  if (match && !w.tmdbId && tmdb.token()) {
    const hits = (await tmdb.search(w.title, getProfile(db).watchRegion)).filter((h) => (raw as { kind?: string }).kind == null || h.kind === w.kind);
    const best = pick(hits.filter((h) => w.year == null || h.year === w.year), w.title);
    if (best) Object.assign(w, { tmdbId: best.tmdbId, kind: best.kind, title: best.title, year: best.year });
  }
  const item = addItem(db, w, source);
  return enrich(db, item.id).catch(() => item);
}

/**
 * Match an item added by title alone (an idea sent to the watchlist) on TMDB,
 * then fill in its details. Skipped when that title is already on the list.
 */
export async function matchByTitle(db: Db, id: number, today: DateStr): Promise<boolean> {
  if (!tmdb.token()) return false;
  const item = getItem(db, id);
  const best = pick(await tmdb.search(item.title, getProfile(db).watchRegion), item.title);
  if (!best) return false;
  if (db.prepare('SELECT 1 FROM watch_items WHERE tmdb_id = ? AND kind = ? AND id != ?').get(best.tmdbId, best.kind, id)) return false;
  updateItem(db, id, { tmdbId: best.tmdbId, kind: best.kind, title: best.title, year: best.year }, today);
  // The match stands even if the details don't come through now; the next refresh fills them in.
  await enrich(db, id).catch(() => null);
  return true;
}

/**
 * Streaming changes: re-check unwatched titles last checked more than three
 * days ago. Also fills in titles that have never been scored, so adding the
 * OMDb key later scores the whole list.
 */
export async function refreshProviders(db: Db, limit = 40): Promise<number> {
  if (!tmdb.token()) return 0;
  const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
  // Never scored at all (added before scores existed), or never by OMDb.
  const unscored = `OR scores IS NULL ${omdb.key() ? 'OR (imdb_id IS NOT NULL AND scores_at IS NULL)' : ''}`;
  const stale = db
    .prepare(`SELECT id FROM watch_items WHERE tmdb_id IS NOT NULL AND ((status != 'watched' AND (providers_at IS NULL OR providers_at < ?)) ${unscored}) ORDER BY coalesce(providers_at, '') LIMIT ?`)
    .all(cutoff, limit) as { id: number }[];
  let n = 0;
  for (const { id } of stale) {
    try {
      await enrich(db, id);
      n++;
    } catch {
      // One failure (a title TMDB dropped) shouldn't stop the rest.
    }
  }
  return n;
}

export function snapshot(db: Db, today: DateStr): WatchSnapshot {
  return { today, items: listItems(db), tmdb: !!tmdb.token(), omdb: !!omdb.key() };
}
