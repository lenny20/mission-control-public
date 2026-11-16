// Calendar actions that may involve Google. The rule: Google first, then the
// database records what Google now holds. If Google refuses or can't be
// reached, nothing changes here either, and the message says so.

import { addDays, today, type DateStr } from '../../shared/dates.ts';
import { eventInput, eventPatch, eventTimes, type EventInput } from '../../shared/calendar/schemas.ts';
import { dayStart } from '../../shared/calendar/time.ts';
import type { CalEvent, CalendarRange, CalendarStatus, EventSource } from '../../shared/calendar/types.ts';
import type { Db } from '../db.ts';
import { UserError } from '../errors.ts';
import * as google from './google.ts';
import * as repo from './repo.ts';

/** How far back and ahead each pull reaches. Older events stay as they were. */
export const PULL_DAYS_BACK = 90;
export const PULL_DAYS_AHEAD = 365;

export type CalendarService = ReturnType<typeof createCalendarService>;

export function createCalendarService(db: Db, timeZone: string) {
  // Google work runs one job at a time, so a pull can never interleave with an edit.
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  /** Note an auth failure so the screen can ask to reconnect, then pass the error on. */
  const watch = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof google.GoogleAuthError) repo.setSetting(db, 'google.error', err.message);
      throw err;
    }
  };

  function status(): CalendarStatus {
    const token = google.readToken();
    const error = repo.getSetting(db, 'google.error');
    return {
      configured: google.readClient() != null,
      connected: token != null,
      account: token?.account ?? null,
      lastSync: repo.getSetting(db, 'google.lastSync'),
      error,
      calendars: token ? repo.listCalendars(db) : [],
      timeZone,
    };
  }

  const token = () => google.readToken() != null;

  function range(from: DateStr, to: DateStr): CalendarRange {
    // Signed out: Google's copies may be stale, so only dashboard events show.
    const events = repo.listEvents(db, from, to, timeZone);
    return { from, to, events: token() ? events : events.filter((e) => !e.calendarId), status: status() };
  }

  /** The Google calendar new events go to: the account's main one. */
  function writeTarget() {
    if (!token()) throw new UserError('Connect Google Calendar first, or save the event to the dashboard only.');
    const cal = repo.primaryCalendar(db);
    if (!cal) throw new UserError("The main Google calendar hasn't loaded yet. Try again in a moment.");
    return cal;
  }

  function editable(ev: CalEvent) {
    if (!ev.calendarId) return null;
    const cal = repo.getCalendar(db, ev.calendarId);
    if (!cal) throw new UserError('That event is on a calendar that is no longer connected.');
    if (!cal.writable) throw new UserError(`You can only view ${cal.name}, so its events can't be changed here.`, 403);
    return cal;
  }

  async function create(raw: unknown, source: Exclude<EventSource, 'google'>): Promise<CalEvent> {
    const input = eventInput.parse(raw);
    const times = repo.storedTimes(input, timeZone);
    const fields = { title: input.title, location: input.location, notes: input.notes, ...times };
    if (!input.google) return repo.insertEvent(db, fields, source);
    return exclusive(() =>
      watch(async () => {
        const cal = writeTarget();
        const g = await google.insertEvent(cal.id, { title: input.title, location: input.location, notes: input.notes, times: input }, timeZone);
        // A pull in another process may have stored it already: take that row over.
        const pulled = repo.findByGoogle(db, cal.id, g.googleId);
        return pulled ? repo.updateEvent(db, pulled, fields, { calendarId: cal.id, event: g }) : repo.insertEvent(db, fields, source, { calendarId: cal.id, event: g });
      }),
    );
  }

  /**
   * Change an event. Only the fields that actually differ are sent to Google,
   * so formatting Google keeps in notes, and anything the dashboard doesn't
   * show, is left alone.
   */
  async function update(id: number, raw: unknown): Promise<CalEvent> {
    const patch = eventPatch.parse(raw);
    return exclusive(() =>
      watch(async () => {
        const ev = repo.getEvent(db, id);
        const before = repo.toInput(ev, timeZone);
        const text = {
          title: patch.title ?? before.title,
          location: patch.location !== undefined ? patch.location : before.location,
          notes: patch.notes !== undefined ? patch.notes : before.notes,
        };
        // Times are only re-checked, and re-stored, when the patch moves them.
        const moved = patch.start !== undefined || patch.end !== undefined;
        const times = moved ? eventTimes.parse({ start: patch.start ?? before.start, end: patch.end ?? before.end }) : null;
        const timesChanged = !!times && (times.start !== before.start || times.end !== before.end);
        const stored = times && timesChanged ? repo.storedTimes(times, timeZone) : { allDay: ev.allDay, start: ev.start, end: ev.end };
        const fields = { ...text, ...stored };
        const changed = {
          ...(text.title !== before.title ? { title: text.title } : {}),
          ...(text.location !== before.location ? { location: text.location } : {}),
          ...(text.notes !== before.notes ? { notes: text.notes } : {}),
          ...(times && timesChanged ? { times } : {}),
        };

        const cal = editable(ev);
        if (cal) {
          if (Object.keys(changed).length === 0) return ev;
          const g = await google.patchEvent(cal.id, repo.googleIdOf(db, id)!, changed, timeZone);
          if (!g) {
            repo.deleteEvent(db, id);
            throw new UserError(`That event was already deleted in Google, so it's been removed here too.`, 410);
          }
          return repo.updateEvent(db, id, fields, { calendarId: cal.id, event: g });
        }
        if (patch.google) {
          const target = writeTarget();
          const g = await google.insertEvent(target.id, { ...text, times: times ?? { allDay: before.start.length === 10, start: before.start, end: before.end } }, timeZone);
          const pulled = repo.findByGoogle(db, target.id, g.googleId);
          if (pulled) repo.deleteEvent(db, pulled);
          return repo.updateEvent(db, id, fields, { calendarId: target.id, event: g });
        }
        return repo.updateEvent(db, id, fields);
      }),
    );
  }

  /**
   * Delete an event, from Google too when it's there. An event on a calendar
   * other than the account's own is shared with other people, so that needs
   * `confirmed`.
   */
  async function remove(id: number, confirmed: boolean): Promise<CalEvent> {
    return exclusive(() =>
      watch(async () => {
        const ev = repo.getEvent(db, id);
        const cal = editable(ev);
        if (cal) {
          if (!cal.primary && !confirmed) {
            throw new UserError(`"${ev.title}" is on ${cal.name}, which other people share. Deleting it removes it for them too, so it needs confirming.`, 409);
          }
          if (ev.hasGuests && !confirmed) {
            throw new UserError(`"${ev.title}" has other people invited. Deleting it can remove it for them too, so it needs confirming.`, 409);
          }
          await google.deleteEvent(cal.id, repo.googleIdOf(db, id)!);
        }
        repo.deleteEvent(db, id);
        return ev;
      }),
    );
  }

  /**
   * Pull every shown calendar. Returns how many stored events changed.
   * Throttled: a pull within `minGapMs` of the last one is skipped.
   */
  async function sync(minGapMs = 0): Promise<number> {
    if (!token()) return 0;
    // Throttle on attempts, not successes, so a failing Google isn't asked again on every focus.
    const last = repo.getSetting(db, 'google.lastAttempt');
    if (minGapMs && last && Date.now() - Date.parse(last) < minGapMs) return 0;
    return exclusive(() =>
      watch(async () => {
        const startedAt = new Date().toISOString();
        repo.setSetting(db, 'google.lastAttempt', startedAt);
        let changes = 0;
        try {
          const before = JSON.stringify(repo.listCalendars(db));
          repo.saveCalendars(db, await google.listCalendars());
          if (JSON.stringify(repo.listCalendars(db)) !== before) changes++;
          const t = today(timeZone);
          const window = { from: addDays(t, -PULL_DAYS_BACK), to: addDays(t, PULL_DAYS_AHEAD) };
          for (const cal of repo.listCalendars(db).filter((c) => c.shown)) {
            let events;
            try {
              events = await google.listEvents(cal.id, dayStart(window.from, timeZone), dayStart(window.to, timeZone));
            } catch (err) {
              // One calendar gone mid-pull shouldn't stop the others; the next list drops it.
              if (err instanceof UserError && err.status === 404) continue;
              throw err;
            }
            changes += repo.applyPull(db, cal.id, events, window, startedAt, timeZone);
          }
          repo.setSetting(db, 'google.lastSync', new Date().toISOString());
          if (repo.getSetting(db, 'google.error')) changes++;
          repo.setSetting(db, 'google.error', null);
          return changes;
        } catch (err) {
          repo.setSetting(db, 'google.error', (err as Error).message);
          throw err;
        }
      }),
    );
  }

  async function finishLogin(code: string, state: string) {
    const account = await google.finishLogin(code, state);
    repo.setSetting(db, 'google.error', null);
    return account;
  }

  function showCalendar(id: string, shown: boolean) {
    repo.setCalendarShown(db, id, shown);
  }

  return { status, range, create, update, remove, sync, finishLogin, showCalendar };
}


export type { EventInput };
