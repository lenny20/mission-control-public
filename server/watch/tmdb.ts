// The Movie Database: search, details and Australian streaming providers.
// Needs a free API read access token in data/tmdb/token. Plain fetch.

import { existsSync, readFileSync } from 'node:fs';
import type { Providers, TmdbHit } from '../../shared/watch/types.ts';
import { paths } from '../config.ts';
import { UserError } from '../errors.ts';

/** Swappable in tests. */
export const http = { fetch: (input: string, init?: RequestInit) => globalThis.fetch(input, init) };

const API = 'https://api.themoviedb.org/3';
export const IMG = 'https://image.tmdb.org/t/p/w342';

export function token(): string | null {
  if (!existsSync(paths.tmdbToken)) return null;
  const t = readFileSync(paths.tmdbToken, 'utf8').trim();
  return t || null;
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const t = token();
  if (!t) throw new UserError('TMDB isn\'t set up yet, so there are no posters or streaming details.');
  const url = `${API}${path}?${new URLSearchParams({ language: 'en-AU', ...params })}`;
  let res: Response;
  try {
    res = await http.fetch(url, { headers: { authorization: `Bearer ${t}`, accept: 'application/json' } });
  } catch {
    throw new UserError("Couldn't reach TMDB. Check the internet connection.", 502);
  }
  if (res.status === 401) throw new UserError("TMDB didn't accept the token in data/tmdb/token. Use the API Read Access Token from TMDB's settings.", 502);
  if (res.status === 404) throw new UserError('TMDB has no such title.', 404);
  if (!res.ok) throw new UserError(`TMDB said: error ${res.status}.`, 502);
  return (await res.json()) as T;
}

type Raw = { id: number; media_type?: string; title?: string; name?: string; release_date?: string; first_air_date?: string; poster_path?: string | null; overview?: string; popularity?: number; vote_count?: number };

const yearOf = (d?: string) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);
const hit = (r: Raw, kind: 'movie' | 'tv'): TmdbHit => ({
  tmdbId: r.id,
  kind,
  title: (r.title ?? r.name ?? '').trim(),
  year: yearOf(r.release_date ?? r.first_air_date),
  poster: r.poster_path ? `${IMG}${r.poster_path}` : null,
  overview: r.overview || null,
  votes: r.vote_count ?? 0,
});

export async function search(q: string, region = 'AU'): Promise<TmdbHit[]> {
  const data = await get<{ results: Raw[] }>('/search/multi', { query: q, include_adult: 'false', region });
  return data.results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 12).map((r) => hit(r, r.media_type as 'movie' | 'tv'));
}

/**
 * One name per service: TMDB lists plans and resellers separately ("Netflix
 * Standard with Ads", "MUBI Amazon Channel"), but it's the same subscription
 * that gets you in.
 */
export function service(name: string): string {
  return name.replace(/\s+(Standard|Basic)?\s*with Ads$/i, '').replace(/\s+Amazon Channel$/i, '').trim();
}

export type Details = TmdbHit & { genres: string[]; runtime: number | null; seasons: number | null; providers: Providers; imdbId: string | null; score: number | null };

export async function details(kind: 'movie' | 'tv', id: number, region = 'AU'): Promise<Details> {
  const d = await get<Raw & { genres?: { name: string }[]; runtime?: number; episode_run_time?: number[]; number_of_seasons?: number; vote_average?: number; vote_count?: number; external_ids?: { imdb_id?: string | null }; 'watch/providers'?: { results?: Record<string, { link?: string; flatrate?: { provider_name: string }[]; rent?: { provider_name: string }[]; buy?: { provider_name: string }[] }> } }>(
    `/${kind}/${id}`,
    { append_to_response: 'watch/providers,external_ids' },
  );
  const au = d['watch/providers']?.results?.[region];
  const names = (xs?: { provider_name: string }[]) => [...new Set((xs ?? []).map((x) => service(x.provider_name)))];
  return {
    ...hit(d, kind),
    genres: (d.genres ?? []).map((g) => g.name),
    runtime: kind === 'movie' ? (d.runtime ?? null) : (d.episode_run_time?.[0] ?? null),
    seasons: kind === 'tv' ? (d.number_of_seasons ?? null) : null,
    providers: { flatrate: names(au?.flatrate), rent: names(au?.rent), buy: names(au?.buy), link: au?.link ?? null },
    imdbId: d.external_ids?.imdb_id || null,
    // A handful of votes isn't a score.
    score: d.vote_count && d.vote_count >= 10 && d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
  };
}
