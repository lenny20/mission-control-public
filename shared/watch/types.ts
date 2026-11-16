import type { DateStr } from '../dates.ts';
import type { WATCH_KINDS, WATCH_STATUSES } from './schemas.ts';

export type Providers = { flatrate: string[]; rent: string[]; buy: string[]; link: string | null };

/** Out of 10 for TMDB and IMDb, out of 100 for the Tomatometer and Metacritic. Null where there's no score. */
export type Scores = { tmdb: number | null; imdb: number | null; imdbVotes: number | null; rottenTomatoes: number | null; metacritic: number | null };

export type WatchItem = {
  id: number;
  kind: (typeof WATCH_KINDS)[number];
  title: string;
  year: number | null;
  tmdbId: number | null;
  /** Full TMDB image URL, or null. */
  poster: string | null;
  overview: string | null;
  genres: string[];
  /** Minutes for a film; for a series, the number of seasons is in `seasons`. */
  runtime: number | null;
  seasons: number | null;
  status: (typeof WATCH_STATUSES)[number];
  rating: number | null;
  note: string | null;
  watchedOn: DateStr | null;
  addedAt: string;
  /** Where it streams in Australia, as of `providersAt`. */
  providers: Providers | null;
  providersAt: string | null;
  imdbId: string | null;
  scores: Scores | null;
  /** When OMDb last gave scores; null if it never has. */
  scoresAt: string | null;
  /** Film & TV card ids it's a comparison title for. */
  comps: number[];
};

export type TmdbHit = { tmdbId: number; kind: 'movie' | 'tv'; title: string; year: number | null; poster: string | null; overview: string | null; votes: number };

export type WatchSnapshot = { today: DateStr; items: WatchItem[]; tmdb: boolean; omdb: boolean };
