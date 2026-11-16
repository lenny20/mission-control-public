// The checks every calendar write goes through, from chat or the dashboard.

import { z } from 'zod';
import { addDays, daysBetween, isDateStr } from '../dates.ts';
import { addMinutes, isLocalDateTime } from './time.ts';

const when = z.string().refine((v) => isDateStr(v) || isLocalDateTime(v), {
  message: 'Times are written YYYY-MM-DDTHH:mm, or YYYY-MM-DD for an all-day event.',
});
// Blank text is stored as null.
const text = (max: number, what: string) =>
  z
    .string()
    .max(max, `Keep the ${what} under ${max.toLocaleString('en-AU')} characters.`)
    .nullable()
    .transform((v) => (v && v.trim() ? v : null));
const optionalText = (max: number, what: string) => text(max, what).default(null);

const title = z.string({ error: 'Give the event a title.' }).trim().min(1, 'Give the event a title.').max(300, 'Keep the title under 300 characters.');

/** Check and complete a start and end; see eventInput. */
function checkTimes<T extends { start: string; end: string | null }>(v: T, ctx: z.RefinementCtx) {
  const allDay = isDateStr(v.start);
  const end = v.end ?? (allDay ? v.start : addMinutes(v.start, 60));
  if (isDateStr(end) !== allDay) {
    ctx.addIssue({ code: 'custom', message: 'Start and end must both be dates (all day) or both have times.' });
    return z.NEVER;
  }
  if (allDay ? end < v.start : end <= v.start) {
    ctx.addIssue({ code: 'custom', message: allDay ? "The last day can't be before the first." : 'The event has to end after it starts.' });
    return z.NEVER;
  }
  if (allDay && daysBetween(v.start, end) > 365) {
    ctx.addIssue({ code: 'custom', message: 'An all-day event can run for a year at most.' });
    return z.NEVER;
  }
  return { ...v, allDay, end };
}

/**
 * One event as people write it. A start with a time makes a timed event; a
 * plain date makes an all-day one. `end` is optional: an hour later for a timed
 * event, the same day for an all-day one. All-day ends are the last day itself.
 */
export const eventInput = z
  .object({
    title,
    start: when,
    end: when.nullable().default(null),
    location: optionalText(500, 'location'),
    notes: optionalText(8_000, 'notes'),
    /** Also put it on the Google calendar the dashboard writes to. */
    google: z.boolean().default(false),
  })
  .transform(checkTimes);
export type EventInput = z.infer<typeof eventInput>;

/**
 * Fields to change on an existing event. Only what's given is checked, so an
 * event made in Google that the dashboard wouldn't allow (a zero-length marker,
 * an all-day event over a year) can still be renamed. New times are checked
 * as a pair. `google: true` adds a dashboard-only event to Google.
 */
export const eventPatch = z.object({
  title: title.optional(),
  start: when.optional(),
  end: when.optional(),
  // No defaults here: a field left out must stay undefined, meaning "unchanged".
  location: text(500, 'location').optional(),
  notes: text(8_000, 'notes').optional(),
  google: z.literal(true, { error: 'An event can be added to Google, not taken off it.' }).optional(),
});
export const eventTimes = z.object({ start: when, end: when.nullable().default(null) }).transform(checkTimes);
export type EventPatch = z.infer<typeof eventPatch>;

/** All-day events store Google's exclusive end; people see the last day. */
export const exclusiveEnd = (lastDay: string) => addDays(lastDay, 1);
export const lastDay = (exclusive: string) => addDays(exclusive, -1);
