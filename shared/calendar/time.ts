// Wall-clock times in a named time zone, and the instants they stand for.
// Timed events are stored as UTC instants; people type and read local times.

import { addDays, isDateStr, type DateStr } from '../dates.ts';

/** 'YYYY-MM-DDTHH:mm', a local wall-clock time. */
export type LocalDateTime = string;

const LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

export function isLocalDateTime(value: string): boolean {
  const m = LOCAL_RE.exec(value);
  return !!m && isDateStr(m[1]!);
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(ms: number, timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(timeZone, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(ms)) out[p.type] = p.value;
  return out as { year: string; month: string; day: string; hour: string; minute: string; second: string };
}

/** How far the zone's clock is ahead of UTC at this instant, in ms. */
function offsetAt(ms: number, timeZone: string): number {
  const p = partsIn(ms, timeZone);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/**
 * The UTC instant (ISO, 'Z') when the zone's clock reads this local time.
 * A time skipped by a daylight-saving jump lands just after the jump.
 */
export function toInstant(local: LocalDateTime, timeZone: string): string {
  const m = LOCAL_RE.exec(local);
  if (!m) throw new Error(`Not a local date-time: ${local}`);
  const [y, mo, d] = m[1]!.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d, Number(m[2]), Number(m[3]));
  let ms = wall - offsetAt(wall, timeZone);
  const second = offsetAt(ms, timeZone);
  if (second !== wall - ms) ms = wall - second;
  return new Date(ms).toISOString();
}

/** The zone's local time at an instant, as 'YYYY-MM-DDTHH:mm'. */
export function toLocal(instant: string, timeZone: string): LocalDateTime {
  const p = partsIn(Date.parse(instant), timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Start of a local day as a UTC instant. */
export function dayStart(date: DateStr, timeZone: string): string {
  return toInstant(`${date}T00:00`, timeZone);
}

/** The local days [from, to) as UTC instants, for range queries. */
export function dayRangeInstants(from: DateStr, to: DateStr, timeZone: string): [string, string] {
  return [dayStart(from, timeZone), dayStart(to, timeZone)];
}

export function addMinutes(local: LocalDateTime, minutes: number): LocalDateTime {
  const m = LOCAL_RE.exec(local)!;
  const total = Number(m[2]) * 60 + Number(m[3]) + minutes;
  const days = Math.floor(total / 1440);
  const rest = total - days * 1440;
  return `${addDays(m[1]!, days)}T${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
}
