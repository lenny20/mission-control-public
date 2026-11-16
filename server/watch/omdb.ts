// OMDb: IMDb, Rotten Tomatoes and Metacritic scores for an IMDb id. Needs a
// free API key in data/omdb/key. The key goes in the URL, so URLs are never
// logged or put in error messages.

import { existsSync, readFileSync } from 'node:fs';
import type { Scores } from '../../shared/watch/types.ts';
import { paths } from '../config.ts';
import { UserError } from '../errors.ts';

/** Swappable in tests. */
export const http = { fetch: (input: string, init?: RequestInit) => globalThis.fetch(input, init) };

export function key(): string | null {
  if (!existsSync(paths.omdbKey)) return null;
  const k = readFileSync(paths.omdbKey, 'utf8').trim();
  return k || null;
}

type Raw = { Response?: string; Error?: string; imdbRating?: string; imdbVotes?: string; Metascore?: string; Ratings?: { Source: string; Value: string }[] };

/** "8.1" or "1,234" or "94%" as a number; "N/A" and anything else as null. */
const parse = (v: string | undefined) => {
  const n = Number((v ?? '').replace(/[,%]/g, '').replace(/\/\d+$/, ''));
  return v && v !== 'N/A' && Number.isFinite(n) ? n : null;
};

export type OmdbScores = Omit<Scores, 'tmdb'>;

export async function scores(imdbId: string): Promise<OmdbScores> {
  const k = key();
  if (!k) throw new UserError("OMDb isn't set up yet, so there are no IMDb or Rotten Tomatoes scores.");
  let res: Response;
  try {
    res = await http.fetch(`https://www.omdbapi.com/?${new URLSearchParams({ i: imdbId, apikey: k })}`, { headers: { accept: 'application/json' } });
  } catch {
    throw new UserError("Couldn't reach OMDb. Check the internet connection.", 502);
  }
  const d = (await res.json().catch(() => ({}))) as Raw;
  if (/limit/i.test(d.Error ?? '')) throw new UserError("OMDb's daily limit is used up. Scores fill in tomorrow.", 502);
  if (res.status === 401 || /api key/i.test(d.Error ?? '')) throw new UserError("OMDb didn't accept the key in data/omdb/key. Check it's the key from OMDb's email, and that you clicked its activation link.", 502);
  // An id OMDb doesn't know is simply a title with no scores.
  if (d.Response === 'False') return { imdb: null, imdbVotes: null, rottenTomatoes: null, metacritic: null };
  if (!res.ok) throw new UserError(`OMDb said: error ${res.status}.`, 502);
  return {
    imdb: parse(d.imdbRating),
    imdbVotes: parse(d.imdbVotes),
    rottenTomatoes: parse(d.Ratings?.find((r) => r.Source === 'Rotten Tomatoes')?.Value),
    metacritic: parse(d.Metascore),
  };
}
