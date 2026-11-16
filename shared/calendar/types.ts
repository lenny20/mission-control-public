import type { DateStr } from '../dates.ts';

/** 'work' marks a card's due date: shown on the calendar, opened on its board (negative id). */
export type EventSource = 'dashboard' | 'chat' | 'google' | 'work';

/**
 * A timed event's `start` and `end` are UTC instants (ISO). An all-day event's
 * are dates, with `end` the day AFTER the last one, as Google stores them.
 */
export type CalEvent = {
  id: number;
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  location: string | null;
  notes: string | null;
  /** The Google calendar it's on, or null for a dashboard-only event. */
  calendarId: string | null;
  htmlLink: string | null;
  meetLink: string | null;
  recurring: boolean;
  /** Other people are invited, so deleting it affects them. */
  hasGuests: boolean;
  source: EventSource;
  updatedAt: string;
};

export type CalendarInfo = {
  id: string;
  name: string;
  color: string;
  primary: boolean;
  writable: boolean;
  shown: boolean;
};

export type CalendarStatus = {
  /** The Google client file is in place, so connecting is possible. */
  configured: boolean;
  connected: boolean;
  account: string | null;
  lastSync: string | null;
  /** Why the last sync or login failed, in plain words. */
  error: string | null;
  calendars: CalendarInfo[];
  timeZone: string;
};

export type CalendarRange = { from: DateStr; to: DateStr; events: CalEvent[]; status: CalendarStatus };
