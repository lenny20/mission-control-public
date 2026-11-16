import { randomUUID } from 'node:crypto';
import { DAVClient, type DAVCalendar } from 'tsdav';
import ICAL from 'ical.js';
import nodeIcal from 'node-ical';
import type { StoredConnection } from '../../shared/calendar/connections.ts';
import { toInstant, toLocal } from '../../shared/calendar/time.ts';
import { UserError } from '../errors.ts';
import { readIcalendar, type IcalInstance } from './ical.ts';
import { boundedText, calendarFetch, checkResponse } from './network.ts';
import type { EventFields, Provider, RemoteEvent } from './provider.ts';
import { storedTimes } from './repo.ts';

type DavConnection = Extract<StoredConnection, { provider: 'icloud' | 'caldav' | 'yahoo' | 'fastmail' }>;
type EventReference = { url: string; uid: string; rid: string | null };
const reference = (url: string, item: IcalInstance) => JSON.stringify({ url, uid: item.uid, rid: item.recurrenceId });
const emptyCalendar = () => { const c = new ICAL.Component('vcalendar'); c.addPropertyWithValue('version', '2.0'); c.addPropertyWithValue('prodid', '-//Mission Control//Calendar//EN'); return c; };

function timeProperty(component: ICAL.Component, name: string, value: string, allDay: boolean) {
  component.removeAllProperties(name);
  const property = new ICAL.Property(name);
  property.resetType(allDay ? 'date' : 'date-time');
  property.setValue(allDay ? ICAL.Time.fromString(value, null) : ICAL.Time.fromJSDate(new Date(value), true));
  component.addProperty(property);
}
export function updateIcalFields(component: ICAL.Component, fields: EventFields, timeZone: string) {
  for (const [field, prop] of [['title', 'summary'], ['location', 'location'], ['notes', 'description']] as const) {
    if (fields[field] !== undefined) component.updatePropertyWithValue(prop, fields[field] ?? '');
  }
  if (fields.times) {
    const times = storedTimes(fields.times, timeZone);
    component.removeAllProperties('duration');
    timeProperty(component, 'dtstart', times.start, times.allDay);
    timeProperty(component, 'dtend', times.end, times.allDay);
  }
  timeProperty(component, 'dtstamp', new Date().toISOString(), false);
  timeProperty(component, 'last-modified', new Date().toISOString(), false);
  component.updatePropertyWithValue('sequence', Number(component.getFirstPropertyValue('sequence') ?? 0) + 1);
}

/** Read privileges, including servers returning a single privilege rather than an array. */
export function davWritable(privileges: unknown): boolean {
  const keys = new Set<string>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { keys.add(key); walk(child); }
  };
  walk(privileges);
  return keys.has('all') || keys.has('write') || (keys.has('writeContent') && keys.has('bind') && keys.has('unbind'));
}

export function caldavProvider(connection: DavConnection, timeZone: string): Provider {
  const serverUrl = connection.provider === 'caldav' ? connection.url : { icloud: 'https://caldav.icloud.com', yahoo: 'https://caldav.calendar.yahoo.com', fastmail: 'https://caldav.fastmail.com' }[connection.provider];
  const origin = new URL(serverUrl).origin;
  const allowed = (u: URL) => connection.provider === 'icloud' ? (u.hostname === 'icloud.com' || u.hostname.endsWith('.icloud.com')) && (!u.port || u.port === '443') : u.origin === origin;
  const authorization = `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`;
  const safeFetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const response = await calendarFetch(url, init, allowed, init?.redirect !== 'manual');
    if (response.status >= 300 && response.status < 400) return response;
    // DAV uses 207 for a successful multi-status response. Never log raw XML.
    checkResponse(response);
    if (response.status === 204) return response;
    return new Response(await boundedText(response), { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  const client = new DAVClient({ serverUrl, credentials: { username: connection.username, password: connection.password }, authMethod: 'Basic', defaultAccountType: 'caldav', fetch: safeFetch });
  let loggedIn = false;
  const login = async () => { if (!loggedIn) { await client.login({ loadCollections: false, loadObjects: false }); loggedIn = true; } };
  const safe = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); }
    catch (error) { if (error instanceof UserError) throw error; throw new UserError('The CalDAV service could not complete this request. Check its address, app password and calendar permissions.', 502); }
  };
  const fetchObject = async (url: string) => {
    const response = await calendarFetch(url, { headers: { authorization, accept: 'text/calendar' } }, allowed);
    if (response.status === 404 || response.status === 410) return null;
    checkResponse(response);
    return { text: await boundedText(response), etag: response.headers.get('etag') };
  };
  async function select(raw: string, ref: EventReference) {
    if (/RECURRENCE-ID[^\r\n]*RANGE=THISANDFUTURE/i.test(raw)) throw new UserError('This series changes all following occurrences. Edit it in its original calendar to preserve that rule.');
    const calendar = new ICAL.Component(ICAL.parse(raw));
    const entries = calendar.getAllSubcomponents('vevent').filter((c) => c.getFirstPropertyValue('uid') === ref.uid);
    const master = entries.find((c) => !c.hasProperty('recurrence-id'));
    if (!ref.rid) return { calendar, component: master ?? null };
    const parsed = await nodeIcal.async.parseICS(raw);
    const base = parsed[ref.uid];
    if (!base || base.type !== 'VEVENT') return { calendar, component: null };
    const zone = base.start.tz ?? timeZone;
    const keyOf = (property: ICAL.Property) => {
      const value = property.getFirstValue() as ICAL.Time;
      if (value.isDate) return value.toString();
      if (value.zone === ICAL.Timezone.utcTimezone) return value.toJSDate().toISOString();
      return new Date(Date.parse(toInstant(value.toString().slice(0, 16), zone)) + value.second * 1000).toISOString();
    };
    let component = entries.find((c) => { const rid = c.getFirstProperty('recurrence-id'); return rid && keyOf(rid) === ref.rid; });
    if (component) return { calendar, component: component.getFirstPropertyValue('status') === 'CANCELLED' ? null : component };
    if (!master) return { calendar, component: null };
    const ms = Date.parse(ref.rid);
    const occurrence = (await readIcalendar(raw, new Date(ms - 172800000).toISOString(), new Date(ms + 172800000).toISOString(), timeZone)).find((i) => i.uid === ref.uid && i.recurrenceId === ref.rid);
    if (!occurrence) return { calendar, component: null };
    component = new ICAL.Component(structuredClone(master.toJSON()));
    for (const p of ['rrule', 'rdate', 'exdate', 'exrule', 'duration']) component.removeAllProperties(p);
    timeProperty(component, 'dtstart', occurrence.event.start, occurrence.event.allDay);
    timeProperty(component, 'dtend', occurrence.event.end, occurrence.event.allDay);
    const originalStart = master.getFirstProperty('dtstart')!;
    const originalTime = originalStart.getFirstValue() as ICAL.Time;
    const rid = new ICAL.Property('recurrence-id');
    rid.resetType(originalTime.isDate ? 'date' : 'date-time');
    if (originalTime.isDate) {
      rid.setValue(ICAL.Time.fromString(ref.rid, null));
    } else if (originalTime.zone === ICAL.Timezone.utcTimezone) rid.setValue(ICAL.Time.fromJSDate(new Date(ref.rid), true));
    else {
      rid.setValue(ICAL.Time.fromString(toLocal(ref.rid, zone) + ':' + String(new Date(ref.rid).getUTCSeconds()).padStart(2, '0'), null));
      const tzid = originalStart.getFirstParameter('tzid');
      if (tzid) rid.setParameter('tzid', tzid);
    }
    component.addProperty(rid);
    calendar.addSubcomponent(component);
    return { calendar, component };
  }
  async function returnedEvent(component: ICAL.Component, eventId: string, etag: string | null) {
    const calendar = emptyCalendar();
    for (const timezone of component.parent?.getAllSubcomponents('vtimezone') ?? []) calendar.addSubcomponent(new ICAL.Component(structuredClone(timezone.toJSON())));
    const calendarZone = component.parent?.getFirstPropertyValue('x-wr-timezone');
    if (calendarZone) calendar.addPropertyWithValue('x-wr-timezone', calendarZone);
    const single = new ICAL.Component(structuredClone(component.toJSON()));
    for (const p of ['rrule', 'rdate', 'exdate', 'exrule', 'recurrence-id']) single.removeAllProperties(p);
    calendar.addSubcomponent(single);
    const instance = (await readIcalendar(calendar.toString(), '1900-01-01T00:00:00.000Z', '2200-01-01T00:00:00.000Z', timeZone))[0];
    if (!instance) throw new UserError('The calendar service saved the event but could not return it. Sync to refresh the calendar.', 502);
    return { ...instance.event, googleId: eventId, recurring: !!(JSON.parse(eventId) as EventReference).rid, etag: etag ?? instance.event.etag };
  }
  return {
    status: () => ({ id: connection.id, provider: connection.provider, label: connection.label, configured: true, connected: true, account: connection.username }),
    listCalendars: () => safe(async () => {
      await login();
      const calendars = await client.fetchCalendars({ props: { 'd:displayname': {}, 'ca:calendar-color': {}, 'd:current-user-privilege-set': {}, 'd:resourcetype': {}, 'c:supported-calendar-component-set': {} }, projectedProps: { currentUserPrivilegeSet: true } });
      return calendars.filter((c) => !c.components?.length || c.components.includes('VEVENT')).map((c) => ({ id: c.url, name: typeof c.displayName === 'string' && c.displayName ? c.displayName : connection.label, color: /^#[0-9a-f]{6,8}$/i.test(c.calendarColor ?? '') ? c.calendarColor!.slice(0, 7) : '#b28ce8', primary: false, writable: davWritable(c.projectedProps?.currentUserPrivilegeSet), selected: true }));
    }),
    listEvents: (calendarId, from, to) => safe(async () => {
      await login();
      const objects = await client.fetchCalendarObjects({ calendar: { url: calendarId } as DAVCalendar, timeRange: { start: from, end: to }, expand: false });
      const events: RemoteEvent[] = [];
      for (const object of objects) {
        if (typeof object.data !== 'string') throw new UserError('CalDAV returned an incomplete calendar object. Cached events have been kept.');
        if (/RECURRENCE-ID[^\r\n]*RANGE=THISANDFUTURE/i.test(object.data)) throw new UserError('This calendar contains a repeating event with an unsupported following-occurrences rule. Cached events have been kept.');
        for (const item of await readIcalendar(object.data, from, to, timeZone)) events.push({ ...item.event, googleId: reference(object.url, item), etag: `${object.etag ?? ''}:${item.event.etag}` });
        if (events.length > 20_000) throw new UserError('This calendar contains too many events to import safely.');
      }
      return events;
    }),
    insertEvent: (calendarId, fields, zone) => safe(async () => {
      const calendar = emptyCalendar();
      const component = new ICAL.Component('vevent');
      const uid = randomUUID();
      component.addPropertyWithValue('uid', uid);
      updateIcalFields(component, fields, zone);
      calendar.addSubcomponent(component);
      const url = new URL(uid + '.ics', calendarId.endsWith('/') ? calendarId : calendarId + '/').href;
      const response = await calendarFetch(url, { method: 'PUT', headers: { authorization, 'content-type': 'text/calendar; charset=utf-8', 'if-none-match': '*' }, body: calendar.toString() }, allowed);
      checkResponse(response);
      const stored = await fetchObject(url);
      if (!stored) throw new UserError('The calendar service did not return the new event. Sync before trying again.', 502);
      const selected = await select(stored.text, { url, uid, rid: null });
      if (!selected.component) throw new UserError('The calendar service did not return the new event. Sync before trying again.', 502);
      return returnedEvent(selected.component, JSON.stringify({ url, uid, rid: null }), stored.etag);
    }),
    patchEvent: (_calendarId, eventId, fields, zone) => safe(async () => {
      const ref = JSON.parse(eventId) as EventReference;
      const current = await fetchObject(ref.url);
      if (!current) return null;
      if (!current.etag) throw new UserError('This CalDAV server did not provide an event revision. Edit in its own app to avoid overwriting another change.');
      const { calendar, component } = await select(current.text, ref);
      if (!component) return null;
      updateIcalFields(component, fields, zone);
      const response = await calendarFetch(ref.url, { method: 'PUT', headers: { authorization, 'content-type': 'text/calendar; charset=utf-8', 'if-match': current.etag }, body: calendar.toString() }, allowed);
      checkResponse(response);
      const stored = await fetchObject(ref.url);
      if (!stored) throw new UserError('The calendar service saved the edit but could not return it. Sync before trying again.', 502);
      const selected = await select(stored.text, ref);
      if (!selected.component) throw new UserError('The calendar service saved the edit but could not return it. Sync before trying again.', 502);
      return returnedEvent(selected.component, eventId, stored.etag);
    }),
    deleteEvent: (_calendarId, eventId) => safe(async () => {
      const ref = JSON.parse(eventId) as EventReference;
      const current = await fetchObject(ref.url);
      if (!current) return;
      if (!current.etag) throw new UserError('This CalDAV server did not provide an event revision. Delete in its own app to avoid deleting another change.');
      const { calendar, component } = await select(current.text, ref);
      if (!component) return;
      if (ref.rid) {
        component.updatePropertyWithValue('status', 'CANCELLED');
        updateIcalFields(component, {}, timeZone);
      } else calendar.removeSubcomponent(component);
      const keep = calendar.getAllSubcomponents('vevent').length > 0;
      const response = await calendarFetch(ref.url, { method: keep ? 'PUT' : 'DELETE', headers: { authorization, 'if-match': current.etag, ...(keep ? { 'content-type': 'text/calendar; charset=utf-8' } : {}) }, ...(keep ? { body: calendar.toString() } : {}) }, allowed);
      if (response.status !== 404 && response.status !== 410) checkResponse(response);
    }),
  };
}
