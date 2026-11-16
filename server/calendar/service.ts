// Calendar actions across providers. The rule: remote first, then the
// database records what the provider now holds. If it refuses or cannot be
// reached, nothing changes here either, and the message says so.

import { addDays, today, type DateStr } from '../../shared/dates.ts';
import { eventInput, eventPatch, eventTimes, type EventInput } from '../../shared/calendar/schemas.ts';
import { dayStart } from '../../shared/calendar/time.ts';
import type { CalEvent, CalendarRange, CalendarStatus } from '../../shared/calendar/types.ts';
import type { Db } from '../db.ts';
import { UserError } from '../errors.ts';
import { calendarProviders } from './providers.ts';
import type { Provider } from './provider.ts';
import { removeConnection } from './connections.ts';
import type { CalendarInfo } from '../../shared/calendar/types.ts';
import * as google from './google.ts';
import * as repo from './repo.ts';

/** How far back and ahead each pull reaches. Older events stay as they were. */
export const PULL_DAYS_BACK = 90;
export const PULL_DAYS_AHEAD = 365;

export type CalendarService = ReturnType<typeof createCalendarService>;

export function createCalendarService(db: Db, timeZone: string, providers: () => Provider[] = () => calendarProviders(timeZone)) {
  // Calendar work runs one job at a time, so a pull can never interleave with an edit.
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  const providerFor = (cal: CalendarInfo) => {
    const provider = providers().find((p) => p.status().id === (cal.connectionId ?? 'google'));
    if (!provider || !provider.status().connected) throw new UserError('This calendar account is disconnected. Connect it again before editing.');
    return provider;
  };

  function status(): CalendarStatus {
    const connections = providers().map((p) => {
      const connection = p.status();
      return { ...connection, lastSync: repo.getSetting(db, `${connection.id}.lastSync`), error: repo.getSetting(db, `${connection.id}.error`) };
    });
    const connected = connections.filter((c) => c.connected);
    const ids = new Set(connected.map((c) => c.id));
    return {
      configured: connections.some((c) => c.configured), connected: connected.length > 0,
      account: connected.map((c) => c.account ?? c.label).join(', ') || null,
      lastSync: connected.map((c) => c.lastSync).filter((v): v is string => !!v).sort().at(-1) ?? null,
      error: [repo.getSetting(db, 'calendar.loginError'), ...connections.filter((c) => c.error).map((c) => `${c.label}: ${c.error}`)].filter(Boolean).join(' ') || null,
      calendars: repo.listCalendars(db).filter((c) => ids.has(c.connectionId ?? 'google')), timeZone, connections,
    };
  }
  function range(from: DateStr, to: DateStr): CalendarRange {
    const current = status();
    const available = new Set(current.calendars.map((c) => c.id));
    return { from, to, events: repo.listEvents(db, from, to, timeZone).filter((e) => !e.calendarId || available.has(e.calendarId)), status: current };
  }
  function writeTarget(input: { google?: boolean; calendarId?: string | null }) {
    if (input.google && input.calendarId) throw new UserError('Choose one destination: google:true or calendarId.');
    const cal = input.calendarId ? repo.getCalendar(db, input.calendarId) : repo.primaryCalendar(db, 'google');
    if (!cal) throw new UserError('Choose a connected calendar, or save to the dashboard only.');
    providerFor(cal);
    if (!cal.writable) throw new UserError('This calendar is read-only.', 403);
    if ((cal.connectionId ?? 'google') === 'google' && !cal.primary) throw new UserError('New Google events go to the account’s primary calendar.');
    return cal;
  }

  function editable(ev: CalEvent) {
    if (!ev.calendarId) return null;
    if (ev.writeProtected) throw new UserError('This event is read-only. Edit it in its original calendar.', 403);
    const cal = repo.getCalendar(db, ev.calendarId);
    if (!cal) throw new UserError('That event is on a calendar that is no longer connected.');
    if (!cal.writable) throw new UserError(`You can only view ${cal.name}, so its events can't be changed here.`, 403);
    return cal;
  }

  async function create(raw: unknown, source: 'chat' | 'dashboard'): Promise<CalEvent> {
    const input = eventInput.parse(raw);
    const times = repo.storedTimes(input, timeZone);
    const fields = { title: input.title, location: input.location, notes: input.notes, ...times };
    if (!input.google && !input.calendarId) return repo.insertEvent(db, fields, source);
    return exclusive(() =>
      (async () => {
        const cal = writeTarget(input);
        const g = await providerFor(cal).insertEvent(repo.remoteCalendarId(db, cal.id), { title: input.title, location: input.location, notes: input.notes, times: input }, timeZone);
        // A pull in another process may have stored it already: take that row over.
        const pulled = repo.findByGoogle(db, cal.id, g.googleId);
        return pulled ? repo.updateEvent(db, pulled, fields, { calendarId: cal.id, event: g }) : repo.insertEvent(db, fields, source, { calendarId: cal.id, event: g });
      })(),
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
      (async () => {
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
        if (cal && ((patch.google && (cal.connectionId ?? 'google') !== 'google') || (patch.calendarId && patch.calendarId !== ev.calendarId))) throw new UserError('An event cannot be moved between accounts here. Create a separate event in the destination calendar.');
        if (cal) {
          if (Object.keys(changed).length === 0) return ev;
          const g = await providerFor(cal).patchEvent(repo.remoteCalendarId(db, cal.id), repo.googleIdOf(db, id)!, changed, timeZone);
          if (!g) {
            repo.deleteEvent(db, id);
            throw new UserError(`That event was already deleted in its calendar, so it's been removed here too.`, 410);
          }
          return repo.updateEvent(db, id, fields, { calendarId: cal.id, event: g });
        }
        if (patch.google || patch.calendarId) {
          const target = writeTarget(patch);
          const g = await providerFor(target).insertEvent(repo.remoteCalendarId(db, target.id), { ...text, times: times ?? { allDay: before.start.length === 10, start: before.start, end: before.end } }, timeZone);
          const pulled = repo.findByGoogle(db, target.id, g.googleId);
          if (pulled) repo.deleteEvent(db, pulled);
          return repo.updateEvent(db, id, fields, { calendarId: target.id, event: g });
        }
        return repo.updateEvent(db, id, fields);
      })(),
    );
  }

  /**
   * Delete an event, from Google too when it's there. An event on a calendar
   * other than the account's own is shared with other people, so that needs
   * `confirmed`.
   */
  async function remove(id: number, confirmed: boolean): Promise<CalEvent> {
    return exclusive(() =>
      (async () => {
        const ev = repo.getEvent(db, id);
        const cal = editable(ev);
        if (cal) {
          if (!cal.primary && !confirmed) {
            throw new UserError(`"${ev.title}" is on ${cal.name}, which other people share. Deleting it removes it for them too, so it needs confirming.`, 409);
          }
          if (ev.hasGuests && !confirmed) {
            throw new UserError(`"${ev.title}" has other people invited. Deleting it can remove it for them too, so it needs confirming.`, 409);
          }
          await providerFor(cal).deleteEvent(repo.remoteCalendarId(db, cal.id), repo.googleIdOf(db, id)!);
        }
        repo.deleteEvent(db, id);
        return ev;
      })(),
    );
  }

  /**
   * Pull every shown calendar. Returns how many stored events changed.
   * Throttled: a pull within `minGapMs` of the last one is skipped.
   */
  async function sync(minGapMs = 0): Promise<number> {
    return exclusive(async () => {
      let changes = 0;
      let successes = 0;
      const errors: Error[] = [];
      for (const provider of providers()) {
        const connection = provider.status();
        if (!connection.connected) continue;
        const last = repo.getSetting(db, `${connection.id}.lastAttempt`);
        if (minGapMs && last && Date.now() - Date.parse(last) < minGapMs) continue;
        const startedAt = new Date().toISOString();
        repo.setSetting(db, `${connection.id}.lastAttempt`, startedAt);
        try {
          const before = JSON.stringify(repo.listCalendars(db, connection.id));
          repo.saveCalendars(db, await provider.listCalendars(), connection.id);
          if (JSON.stringify(repo.listCalendars(db, connection.id)) !== before) changes++;
          const t = today(timeZone);
          const window = { from: addDays(t, -PULL_DAYS_BACK), to: addDays(t, PULL_DAYS_AHEAD) };
          for (const cal of repo.listCalendars(db, connection.id).filter((c) => c.shown)) {
            let events;
            try { events = await provider.listEvents(repo.remoteCalendarId(db, cal.id), dayStart(window.from, timeZone), dayStart(window.to, timeZone)); }
            catch (error) { if (error instanceof UserError && error.status === 404) continue; throw error; }
            // A disconnected account must not reappear when an older pull finishes.
            if (!providers().some((p) => p.status().id === connection.id && p.status().connected)) break;
            changes += repo.applyPull(db, cal.id, events, window, startedAt, timeZone, connection.id === 'google' ? 'google' : 'remote');
          }
          repo.setSetting(db, `${connection.id}.lastSync`, new Date().toISOString());
          if (repo.getSetting(db, `${connection.id}.error`)) changes++;
          repo.setSetting(db, `${connection.id}.error`, null);
          successes++;
        } catch (error) {
          const safe = error instanceof UserError ? error : new UserError('This calendar could not sync. Its previous events have been kept.', 502);
          repo.setSetting(db, `${connection.id}.error`, safe.message);
          errors.push(safe);
        }
      }
      if (errors.length && !successes) throw errors[0];
      return changes;
    });
  }

  async function disconnect(id: string) {
    return exclusive(async () => {
      if (id === 'google') google.forgetToken();
      else removeConnection(id);
      repo.saveCalendars(db, [], id);
      for (const key of ['error', 'lastSync', 'lastAttempt']) repo.setSetting(db, `${id}.${key}`, null);
    });
  }

  async function finishLogin(code: string, state: string) {
    const account = await google.finishLogin(code, state);
    repo.setSetting(db, 'google.error', null);
    return account;
  }

  function showCalendar(id: string, shown: boolean) {
    repo.setCalendarShown(db, id, shown);
  }

  return { status, range, create, update, remove, sync, finishLogin, showCalendar, disconnect };
}


export type { EventInput };
