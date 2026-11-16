// The checks every Watchlist write goes through, from chat or the dashboard.

import { z } from 'zod';
import { dateStr } from '../health/schemas.ts';

export const WATCH_KINDS = ['movie', 'tv'] as const;
export const WATCH_STATUSES = ['to-watch', 'watching', 'watched'] as const;
export const STATUS_LABELS: Record<(typeof WATCH_STATUSES)[number], string> = { 'to-watch': 'To watch', watching: 'Watching', watched: 'Watched' };

const title = z.string({ error: 'Give the title.' }).trim().min(1, 'Give the title.').max(300, 'Keep the title under 300 characters.');
const year = z.number().int().min(1880, 'That year looks wrong.').max(2100, 'That year looks wrong.');

export const watchInput = z.object({
  title,
  kind: z.enum(WATCH_KINDS, { error: 'It\'s a movie or tv.' }).default('movie'),
  year: year.nullable().default(null),
  /** A TMDB match, when there is one. */
  tmdbId: z.number().int().positive().nullable().default(null),
  status: z.enum(WATCH_STATUSES).default('to-watch'),
});

export const watchPatch = z
  .object({
    title,
    kind: z.enum(WATCH_KINDS),
    year: year.nullable(),
    tmdbId: z.number().int().positive().nullable(),
    status: z.enum(WATCH_STATUSES, { error: 'The status is to-watch, watching or watched.' }),
    /** Out of 5. */
    rating: z.number().int('Ratings are whole stars.').min(1, 'Ratings are 1 to 5 stars.').max(5, 'Ratings are 1 to 5 stars.').nullable(),
    note: z
      .string()
      .max(200, 'Keep the note to one line, under 200 characters.')
      .nullable()
      .transform((v) => (v && v.trim() ? v.trim().replace(/\s*\n\s*/g, ' ') : null)),
    watchedOn: dateStr.nullable(),
    /** Film & TV cards this is a comparison title for. */
    comps: z.array(z.number().int().positive()).max(20),
  })
  .partial()
  .strict()
  // A TMDB id means nothing without knowing whether it's a film or a series.
  .refine((p) => p.tmdbId == null || p.kind != null, { message: 'Give "kind" (movie or tv) along with a new tmdbId.' });
