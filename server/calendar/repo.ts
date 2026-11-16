// Calendar storage. Everything here is local to the database; talking to
// Google happens in service.ts, which calls these to record the result.

import { createHash } from 'node:crypto';
import { addDays, type DateStr } from '../../shared/dates.ts';
import { exclusiveEnd, lastDay, type EventInput } from '../../shared/calendar/schemas.ts';
import { dayRangeInstants, toInstant, toLocal } from '../../shared/calendar/time.ts';
import type { CalEvent, CalendarInfo, EventSource } from '../../shared/calendar/types.ts';
import { transaction, type Db } from '../db.ts';
import { UserError } from '../errors.ts';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const now = () => new Date().toISOString();

// ------------------------------------------------------------------ settings

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
  return row ? String(row.value) : null;
}

export function setSetting(db: Db, key: string, value: string | null) {
  if (value == null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// ------------------------------------------------------------------ calendars

function rowToCalendar(r: Row): CalendarInfo {
  return { id: String(r.id), name: String(r.name), color: String(r.color), primary: !!r.is_primary, writable: !!r.writable, shown: !!r.shown, connectionId: String(r.connection_id ?? 'google') };
}

export function listCalendars(db: Db, connectionId?: string): CalendarInfo[] {
  return (connectionId ? db.prepare('SELECT * FROM calendars WHERE connection_id = ? ORDER BY is_primary DESC, position, name').all(connectionId) : db.prepare('SELECT * FROM calendars ORDER BY is_primary DESC, position, name').all() as Row[]).map((r) => rowToCalendar(r as Row));
}

export function getCalendar(db: Db, id: string): CalendarInfo | null {
  const row = db.prepare('SELECT * FROM calendars WHERE id = ?').get(id) as Row | undefined;
  return row ? rowToCalendar(row) : null;
}

export function primaryCalendar(db: Db, connectionId = 'google'): CalendarInfo | null {
  const row = db.prepare('SELECT * FROM calendars WHERE is_primary = 1 AND connection_id = ?').get(connectionId) as Row | undefined;
  return row ? rowToCalendar(row) : null;
}

/**
 * Record the account's calendars. A calendar seen for the first time is shown
 * if it's the main one or ticked in Google Calendar itself; after that, the
 * dashboard's own choice sticks. Calendars gone from the account are dropped.
 */
export function saveCalendars(db: Db, found: (Omit<CalendarInfo, 'shown'> & { selected: boolean })[], connectionId = 'google') {
  const remoteIds = new Map(found.map((c) => [storedCalendarId(connectionId, c.id), c.id]));
  found = found.map((c) => ({ ...c, id: storedCalendarId(connectionId, c.id) }));
  transaction(db, () => {
    const known = new Set(listCalendars(db, connectionId).map((c) => c.id));
    found.forEach((c, i) => {
      if (known.has(c.id)) {
        db.prepare('UPDATE calendars SET name = ?, color = ?, is_primary = ?, writable = ?, position = ? WHERE id = ?').run(c.name, c.color, c.primary ? 1 : 0, c.writable ? 1 : 0, i, c.id);
      } else {
        db.prepare('INSERT INTO calendars (id, name, color, is_primary, writable, shown, position) VALUES (?, ?, ?, ?, ?, ?, ?)').run(c.id, c.name, c.color, c.primary ? 1 : 0, c.writable ? 1 : 0, c.primary || c.selected ? 1 : 0, i);
      }
      db.prepare('UPDATE calendars SET connection_id = ?, remote_id = ? WHERE id = ?').run(connectionId, remoteIds.get(c.id)!, c.id);
    });
    const ids = new Set(found.map((c) => c.id));
    for (const id of known) {
      if (ids.has(id)) continue;
      db.prepare('DELETE FROM events WHERE calendar_id = ?').run(id);
      db.prepare('DELETE FROM calendars WHERE id = ?').run(id);
    }
  });
}

export function setCalendarShown(db: Db, id: string, shown: boolean) {
  const res = db.prepare('UPDATE calendars SET shown = ? WHERE id = ?').run(shown ? 1 : 0, id);
  if (res.changes === 0) throw new UserError('That calendar is not on a connected account.', 404);
}

// ------------------------------------------------------------------ events

function rowToEvent(r: Row): CalEvent {
  return {
    id: Number(r.id),
    title: String(r.title),
    allDay: !!r.all_day,
    start: String(r.start),
    end: String(r.end),
    location: str(r.location),
    notes: str(r.notes),
    calendarId: str(r.calendar_id),
    htmlLink: str(r.html_link),
    meetLink: str(r.meet_link),
    recurring: !!r.recurring,
    hasGuests: !!r.has_guests,
    source: String(r.source) as EventSource,
    updatedAt: String(r.updated_at),
    writeProtected: !!r.write_protected,
  };
}

/** Rows overlapping the local days [from, to). */
const OVERLAPS = `((all_day = 0 AND start < :toI AND end > :fromI) OR (all_day = 1 AND start < :to AND end > :from))`;

/**
 * Events on shown calendars that overlap the local days [from, to). An
 * invitation on two shown calendars has the same Google id on both, and is
 * listed once, preferring the copy on the account's own calendar.
 */
export function listEvents(db: Db, from: DateStr, to: DateStr, timeZone: string): CalEvent[] {
  const [fromI, toI] = dayRangeInstants(from, to, timeZone);
  const rows = db
    .prepare(
      `SELECT events.*, calendars.is_primary AS cal_primary, calendars.connection_id AS cal_connection FROM events LEFT JOIN calendars ON calendars.id = events.calendar_id
       WHERE ${OVERLAPS} AND (calendar_id IS NULL OR calendars.shown = 1) ORDER BY start, events.id`,
    )
    .all({ from, to, fromI, toI }) as Row[];
  const best = new Map<string, Row>();
  for (const r of rows) {
    if (r.google_id == null) continue;
    const key = JSON.stringify([r.cal_connection ?? 'google', r.google_id]);
    const had = best.get(key);
    if (!had || (!had.cal_primary && r.cal_primary)) best.set(key, r);
  }
  return rows.filter((r) => r.google_id == null || best.get(JSON.stringify([r.cal_connection ?? 'google', r.google_id])) === r).map(rowToEvent);
}

export function getEvent(db: Db, id: number): CalEvent {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new UserError(`There's no event with id ${id}.`, 404);
  return rowToEvent(row);
}

/** The stored row for a Google event, if any. */
export function findByGoogle(db: Db, calendarId: string, googleId: string): number | null {
  const row = db.prepare('SELECT id FROM events WHERE calendar_id = ? AND google_id = ?').get(calendarId, googleId) as Row | undefined;
  return row ? Number(row.id) : null;
}

export function googleIdOf(db: Db, id: number): string | null {
  const row = db.prepare('SELECT google_id FROM events WHERE id = ?').get(id) as Row | undefined;
  return str(row?.google_id);
}

/** Stored times as people write them: local times, or dates with the last day as the end. */
export function toInput(ev: CalEvent, timeZone: string): Pick<EventInput, 'title' | 'start' | 'end' | 'location' | 'notes'> {
  return {
    title: ev.title,
    start: ev.allDay ? ev.start : toLocal(ev.start, timeZone),
    end: ev.allDay ? lastDay(ev.end) : toLocal(ev.end, timeZone),
    location: ev.location,
    notes: ev.notes,
  };
}

/** The other way: what goes in the start and end columns. */
export function storedTimes(input: Pick<EventInput, 'allDay' | 'start' | 'end'>, timeZone: string) {
  return input.allDay
    ? { allDay: true, start: input.start, end: exclusiveEnd(input.end) }
    : { allDay: false, start: toInstant(input.start, timeZone), end: toInstant(input.end, timeZone) };
}

/** What Google knows about an event, normalised to our columns. */
export type GoogleEvent = {
  googleId: string;
  etag: string | null;
  updated: string | null;
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  location: string | null;
  notes: string | null;
  htmlLink: string | null;
  meetLink: string | null;
  recurring: boolean;
  hasGuests: boolean;
  writeProtected?: boolean;
};

type EventFields = { title: string; allDay: boolean; start: string; end: string; location: string | null; notes: string | null };

export function insertEvent(db: Db, fields: EventFields, source: EventSource, google?: { calendarId: string; event: GoogleEvent }): CalEvent {
  const t = now();
  const g = google?.event;
  const res = db
    .prepare(
      `INSERT INTO events (title, all_day, start, end, location, notes, calendar_id, google_id, google_etag, google_updated, html_link, meet_link, recurring, has_guests, source, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      g?.title ?? fields.title,
      (g?.allDay ?? fields.allDay) ? 1 : 0,
      g?.start ?? fields.start,
      g?.end ?? fields.end,
      g ? g.location : fields.location,
      g ? g.notes : fields.notes,
      google?.calendarId ?? null,
      g?.googleId ?? null,
      g?.etag ?? null,
      g?.updated ?? null,
      g?.htmlLink ?? null,
      g?.meetLink ?? null,
      g?.recurring ? 1 : 0,
      g?.hasGuests ? 1 : 0,
      source,
      g ? t : null,
      t,
      t,
    );
  db.prepare('UPDATE events SET write_protected = ? WHERE id = ?').run(g?.writeProtected ? 1 : 0, Number(res.lastInsertRowid));
  return getEvent(db, Number(res.lastInsertRowid));
}

/** Overwrite an event's fields; with `google`, from what Google now holds. */
export function updateEvent(db: Db, id: number, fields: EventFields, google?: { calendarId: string; event: GoogleEvent }): CalEvent {
  const g = google?.event;
  const t = now();
  db.prepare(
    `UPDATE events SET title = ?, all_day = ?, start = ?, end = ?, location = ?, notes = ?, updated_at = ?,
       calendar_id = COALESCE(?, calendar_id), google_id = COALESCE(?, google_id), google_etag = COALESCE(?, google_etag),
       google_updated = COALESCE(?, google_updated), html_link = COALESCE(?, html_link), meet_link = ?,
       recurring = COALESCE(?, recurring), has_guests = COALESCE(?, has_guests), synced_at = COALESCE(?, synced_at)
     WHERE id = ?`,
  ).run(
    g?.title ?? fields.title,
    (g?.allDay ?? fields.allDay) ? 1 : 0,
    g?.start ?? fields.start,
    g?.end ?? fields.end,
    g ? g.location : fields.location,
    g ? g.notes : fields.notes,
    t,
    google?.calendarId ?? null,
    g?.googleId ?? null,
    g?.etag ?? null,
    g?.updated ?? null,
    g?.htmlLink ?? null,
    g ? g.meetLink : (getEvent(db, id).meetLink ?? null),
    g ? (g.recurring ? 1 : 0) : null,
    g ? (g.hasGuests ? 1 : 0) : null,
    g ? t : null,
    id,
  );
  if (g) db.prepare('UPDATE events SET write_protected = ? WHERE id = ?').run(g.writeProtected ? 1 : 0, id);
  return getEvent(db, id);
}

export function deleteEvent(db: Db, id: number) {
  transaction(db, () => {
    const row = db.prepare('SELECT calendar_id, google_id FROM events WHERE id = ?').get(id) as Row | undefined;
    if (row?.google_id) {
      db.prepare('INSERT INTO deleted_events (calendar_id, google_id, deleted_at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET deleted_at = excluded.deleted_at').run(String(row.calendar_id), String(row.google_id), now());
    }
    db.prepare('DELETE FROM events WHERE id = ?').run(id);
  });
}

// ------------------------------------------------------------------ pulling from Google

/**
 * Bring one calendar's events for a window in line with Google: add new ones,
 * update changed ones, and remove ones Google no longer has. Returns how many
 * rows changed.
 *
 * Guards against a pull that started before a dashboard edit finished:
 * a pulled copy older than the stored one is ignored, and an event linked to
 * Google after the pull began is never removed for being missing from it.
 */
export function applyPull(db: Db, calendarId: string, pulled: GoogleEvent[], window: { from: DateStr; to: DateStr }, pulledAt: string, timeZone: string, source: EventSource = 'google'): number {
  return transaction(db, () => {
    let changes = 0;
    const find = db.prepare('SELECT id, google_etag, google_updated FROM events WHERE calendar_id = ? AND google_id = ?');
    const deletedSince = db.prepare('SELECT 1 FROM deleted_events WHERE calendar_id = ? AND google_id = ? AND deleted_at >= ?');
    const t = now();
    db.prepare('DELETE FROM deleted_events WHERE deleted_at < ?').run(new Date(Date.now() - 86_400_000).toISOString());
    for (const g of pulled) {
      const row = find.get(calendarId, g.googleId) as Row | undefined;
      if (!row) {
        // Deleted here after this pull began: Google's answer is already out of date.
        if (deletedSince.get(calendarId, g.googleId, pulledAt)) continue;
        insertEvent(db, g, source, { calendarId, event: g });
        changes++;
        continue;
      }
      if (row.google_etag === g.etag) continue;
      if (row.google_updated && g.updated && g.updated < String(row.google_updated)) continue;
      db.prepare(
        `UPDATE events SET title = ?, all_day = ?, start = ?, end = ?, location = ?, notes = ?, google_etag = ?, google_updated = ?,
           html_link = ?, meet_link = ?, recurring = ?, has_guests = ?, updated_at = ? WHERE id = ?`,
      ).run(g.title, g.allDay ? 1 : 0, g.start, g.end, g.location, g.notes, g.etag, g.updated, g.htmlLink, g.meetLink, g.recurring ? 1 : 0, g.hasGuests ? 1 : 0, t, Number(row.id));
      db.prepare('UPDATE events SET write_protected = ? WHERE id = ?').run(g.writeProtected ? 1 : 0, Number(row.id));
      changes++;
    }

    // Only remove inside the window, a day in from each edge, so an event Google
    // counts as just outside it is never dropped by mistake.
    const from = addDays(window.from, 1);
    const to = addDays(window.to, -1);
    const [fromI, toI] = dayRangeInstants(from, to, timeZone);
    const seen = new Set(pulled.map((g) => g.googleId));
    const candidates = db
      .prepare(`SELECT id, google_id, synced_at FROM events WHERE calendar_id = :cal AND google_id IS NOT NULL AND ${OVERLAPS}`)
      .all({ cal: calendarId, from, to, fromI, toI }) as Row[];
    for (const r of candidates) {
      if (seen.has(String(r.google_id))) continue;
      if (r.synced_at && String(r.synced_at) >= pulledAt) continue;
      db.prepare('DELETE FROM events WHERE id = ?').run(Number(r.id));
      changes++;
    }
    return changes;
  });
}

/** Calendar URLs and provider ids stay on the server; the UI sees only an opaque id. */
export function storedCalendarId(connectionId: string, remoteId: string) {
  return connectionId === 'google' ? remoteId : `${connectionId}:${createHash('sha256').update(remoteId).digest('hex').slice(0, 24)}`;
}
export function remoteCalendarId(db: Db, id: string): string {
  const row = db.prepare('SELECT remote_id FROM calendars WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new UserError('That calendar is no longer connected.', 404);
  return String(row.remote_id ?? id);
}
