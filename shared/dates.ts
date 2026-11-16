// Calendar days are plain 'YYYY-MM-DD' strings in the user's local time zone.
// All arithmetic happens on the date itself (via UTC midnight), so a day never
// slips across a time-zone or daylight-saving boundary.

export type DateStr = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateStr(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toUtc(date: DateStr): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): DateStr {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: DateStr, days: number): DateStr {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function daysBetween(from: DateStr, to: DateStr): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** Today's date in the given IANA time zone (defaults to the machine's). */
export function today(timeZone?: string, now: Date = new Date()): DateStr {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Monday of the week containing `date`. */
export function weekStart(date: DateStr): DateStr {
  const dow = toUtc(date).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export function dateRange(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekday(date: DateStr): number {
  return toUtc(date).getUTCDay();
}

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-AU', { ...opts, timeZone: 'UTC' });

const shortFmt = fmt({ day: 'numeric', month: 'short' });
const longFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const dowFmt = fmt({ weekday: 'short' });
const dayMonthYearFmt = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const monthYearFmt = fmt({ month: 'long', year: 'numeric' });
const monthShortFmt = fmt({ month: 'short' });

/** "4 Nov" */
export const formatShort = (date: DateStr) => shortFmt.format(toUtc(date));
/** "Wednesday 4 November" */
export const formatLong = (date: DateStr) => longFmt.format(toUtc(date)).replace(',', '');
/** "Wed" */
export const formatDow = (date: DateStr) => dowFmt.format(toUtc(date));
/** "4 Nov 2026" */
export const formatDayMonthYear = (date: DateStr) => dayMonthYearFmt.format(toUtc(date));
/** "November 2026" */
export const formatMonthYear = (date: DateStr) => monthYearFmt.format(toUtc(date));
/** "Nov" */
export const formatMonthShort = (date: DateStr) => monthShortFmt.format(toUtc(date));

/** "today", "yesterday", "3 days ago", or "4 Nov" past a week. */
export function relativeDay(date: DateStr, now: DateStr): string {
  const n = daysBetween(date, now);
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n === -1) return 'tomorrow';
  if (n > 1 && n < 7) return `${n} days ago`;
  return formatShort(date);
}
