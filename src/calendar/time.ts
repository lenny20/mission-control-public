// Calendar maths in the browser's own time zone, which is the dashboard's.

import { addDays, type DateStr } from '../../shared/dates.ts';
import type { CalEvent } from '../../shared/calendar/types.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day of an instant. */
export const localDate = (d: Date): DateStr => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 'HH:mm' of an instant, local. */
export const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** Midnight at the start of a local day. */
export const midnight = (date: DateStr) => new Date(`${date}T00:00`);

const timeFmt = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true });
/** "9 am", "2:30 pm". */
export function fmtTime(d: Date): string {
  const parts = timeFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const minute = get('minute');
  return `${get('hour')}${minute === '00' ? '' : `:${minute}`} ${get('dayPeriod').toLowerCase().replace(/\./g, '')}`;
}

/** "9 – 10 am", "11:30 am – 1 pm". */
export function fmtRange(a: Date, b: Date): string {
  const sa = fmtTime(a);
  const sb = fmtTime(b);
  const pa = sa.slice(-2);
  return pa === sb.slice(-2) && localDate(a) === localDate(b) ? `${sa.slice(0, -3)} – ${sb}` : `${sa} – ${sb}`;
}

/**
 * Where an event sits on a timeline. All-day events and timed ones of a day or
 * more go in the all-day lane, as most calendars do.
 */
export type Placed = { ev: CalEvent; start: Date; end: Date; lane: 'allday' | 'timed' };

export function place(ev: CalEvent): Placed {
  const start = ev.allDay ? midnight(ev.start) : new Date(ev.start);
  const end = ev.allDay ? midnight(ev.end) : new Date(ev.end);
  const long = !ev.allDay && end.getTime() - start.getTime() >= 24 * 3_600_000;
  return { ev, start, end, lane: ev.allDay || long ? 'allday' : 'timed' };
}

/** Does it touch the local day? */
export function onDay(p: Placed, date: DateStr): boolean {
  const s = midnight(date);
  const e = midnight(addDays(date, 1));
  return p.start < e && p.end > s;
}

/** First and last local day an event covers. */
export function daySpan(p: Placed): [DateStr, DateStr] {
  const last = new Date(p.end.getTime() - 1);
  return [localDate(p.start), localDate(last < p.start ? p.start : last)];
}

export const sortPlaced = (a: Placed, b: Placed) =>
  (a.lane === b.lane ? 0 : a.lane === 'allday' ? -1 : 1) || a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime() || a.ev.title.localeCompare(b.ev.title);

/** Colour of an event: its Google calendar's, the dashboard's own, or a card's deadline. */
export function colourOf(ev: CalEvent, colours: Map<string, string>): string {
  if (ev.source === 'work') return 'var(--cal-deadline)';
  return (ev.calendarId && colours.get(ev.calendarId)) || 'var(--cal-local)';
}

/** Google's notes can hold HTML. Shown and edited as plain text. */
export function plainNotes(notes: string | null): string {
  if (!notes) return '';
  if (!/<[a-z][\s\S]*>/i.test(notes)) return notes;
  const doc = new DOMParser().parseFromString(notes.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n'), 'text/html');
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}
