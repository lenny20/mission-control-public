// Calendar events for whatever date ranges are on screen. Each range is fetched
// once, kept, and refetched when the server reports a change or after an edit.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { DateStr } from '../../shared/dates.ts';
import type { CalendarRange, CalendarStatus } from '../../shared/calendar/types.ts';
import { api } from '../lib/api.ts';
import { onServerChange } from '../lib/store.ts';

type Entry = { data: CalendarRange | null; error: string | null; inflight: Promise<void> | null; users: number };
const ranges = new Map<string, Entry>();
const subs = new Set<() => void>();
let version = 0;
let latestStatus: CalendarStatus | null = null;
const emit = () => {
  version++;
  subs.forEach((s) => s());
};

function load(key: string): Promise<void> {
  const entry = ranges.get(key);
  if (!entry) return Promise.resolve();
  const [from, to] = key.split('/') as [DateStr, DateStr];
  entry.inflight ??= api
    .get<CalendarRange>(`/api/calendar?from=${from}&to=${to}`)
    .then((data) => {
      entry.data = data;
      entry.error = null;
      latestStatus = data.status;
    })
    .catch((err: Error) => {
      entry.error = err.message;
    })
    .finally(() => {
      entry.inflight = null;
      emit();
    });
  return entry.inflight;
}

/** Refetch every range on screen. Ranges no longer shown are dropped. */
export async function refreshCalendar(): Promise<void> {
  for (const [key, e] of ranges) if (e.users === 0) ranges.delete(key);
  await Promise.all([...ranges.keys()].map(async (k) => {
    await ranges.get(k)?.inflight;
    await load(k);
  }));
}
onServerChange(() => void refreshCalendar());

/** Events overlapping the local days [from, to). */
export function useCalendar(from: DateStr, to: DateStr): { data: CalendarRange | null; error: string | null } {
  const key = `${from}/${to}`;
  useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => version,
  );
  useEffect(() => {
    let entry = ranges.get(key);
    if (!entry) {
      entry = { data: null, error: null, inflight: null, users: 0 };
      ranges.set(key, entry);
      void load(key);
    }
    entry.users++;
    return () => {
      entry.users--;
    };
  }, [key]);
  const entry = ranges.get(key);
  // While a new range loads, keep showing the last one rather than flashing empty.
  const last = useRef<CalendarRange | null>(null);
  if (entry?.data) last.current = entry.data;
  return { data: entry?.data ?? last.current, error: entry?.error ?? null };
}

export function useCalendarStatus(): CalendarStatus | null {
  useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => version,
  );
  return latestStatus;
}

/** Run a calendar write, then refetch what's on screen. Throws the server's message. */
export async function calMutate<T>(fn: () => Promise<T>): Promise<T> {
  const out = await fn();
  await refreshCalendar();
  return out;
}

/** Ask the server to pull connected calendars; it skips if it pulled in the last 30 seconds. */
export function requestSync(force = false) {
  return api
    .post<CalendarStatus>(`/api/calendar/sync${force ? '?force=1' : ''}`)
    .then((s) => {
      latestStatus = s;
      emit();
      void refreshCalendar();
      return s;
    })
    .catch((err: Error) => {
      void refreshCalendar();
      throw err;
    });
}
