import { PublicClientApplication } from '@azure/msal-node';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { StoredConnection } from '../../shared/calendar/connections.ts';
import { UserError } from '../errors.ts';
import { connectionFile, getConnection, writePrivate } from './connections.ts';
import { boundedText, calendarFetch, checkResponse } from './network.ts';
import type { EventFields, Provider, RemoteEvent } from './provider.ts';
import { storedTimes } from './repo.ts';

type MicrosoftConnection = Extract<StoredConnection, { provider: 'microsoft' }>;
type SavedCache = { accountId: string; username: string; cache: string };
const scopesFor = (connection: MicrosoftConnection) => ['Calendars.ReadWrite', 'offline_access', 'User.Read', ...(!['common', 'consumers'].includes(connection.tenant) ? ['Calendars.ReadWrite.Shared'] : [])];
const API = 'https://graph.microsoft.com/v1.0';
const pending = new Map<string, { id: string; verifier: string; redirectUri: string; at: number }>();
function cache(id: string): SavedCache | null {
  if (!existsSync(connectionFile(id, true))) return null;
  try { return JSON.parse(readFileSync(connectionFile(id, true), 'utf8')) as SavedCache; }
  catch { throw new UserError('The Microsoft login cache cannot be read. Reconnect this account.'); }
}
export const microsoftAuth = {
  client(connection: MicrosoftConnection) {
    const client = new PublicClientApplication({ auth: { clientId: connection.clientId, authority: `https://login.microsoftonline.com/${connection.tenant}` }, system: { loggerOptions: { loggerCallback: () => {}, piiLoggingEnabled: false } } });
    const saved = cache(connection.id);
    if (saved) client.getTokenCache().deserialize(saved.cache);
    return client;
  },
  async accessToken(connection: MicrosoftConnection): Promise<string> {
    const saved = cache(connection.id);
    if (!saved) throw new UserError('Microsoft Calendar is not signed in. Connect this account.', 401);
    try {
      const client = microsoftAuth.client(connection);
      const account = (await client.getTokenCache().getAllAccounts()).find((a) => a.homeAccountId === saved.accountId);
      if (!account) throw new Error('No cached account');
      const result = await client.acquireTokenSilent({ account, scopes: scopesFor(connection) });
      writePrivate(connectionFile(connection.id, true), JSON.stringify({ ...saved, cache: client.getTokenCache().serialize() }));
      return result.accessToken;
    } catch { throw new UserError('Microsoft could not refresh this login. Reconnect this account.', 401); }
  },
};
export async function microsoftAuthUrl(id: string, redirectUri: string) {
  const c = getConnection(id);
  if (c.provider !== 'microsoft') throw new UserError('This is not a Microsoft connection.');
  for (const [key, value] of pending) if (Date.now() - value.at > 15 * 60_000) pending.delete(key);
  const state = randomBytes(24).toString('hex');
  const verifier = randomBytes(48).toString('base64url');
  pending.set(state, { id, verifier, redirectUri, at: Date.now() });
  try { return await microsoftAuth.client(c).getAuthCodeUrl({ scopes: scopesFor(c), redirectUri, state, codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256', prompt: 'select_account' }); }
  catch { pending.delete(state); throw new UserError('Microsoft sign-in could not start. Check this app registration and the connection.'); }
}
export async function finishMicrosoftLogin(code: string, state: string) {
  const attempt = pending.get(state);
  pending.delete(state);
  if (!attempt || Date.now() - attempt.at > 15 * 60_000) throw new UserError('This sign-in link expired. Start again from Calendar.');
  const c = getConnection(attempt.id);
  if (c.provider !== 'microsoft') throw new UserError('This calendar connection changed. Start sign-in again.');
  try {
    const client = microsoftAuth.client(c);
    const result = await client.acquireTokenByCode({ code, codeVerifier: attempt.verifier, redirectUri: attempt.redirectUri, scopes: scopesFor(c) });
    if (!result.account) throw new Error('No account');
    const previous = cache(c.id);
    if (previous && previous.accountId !== result.account.homeAccountId) throw new UserError('This connection belongs to another Microsoft account. Add a separate connection for the new account.');
    writePrivate(connectionFile(c.id, true), JSON.stringify({ accountId: result.account.homeAccountId, username: result.account.username, cache: client.getTokenCache().serialize() }));
    return c.id;
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Microsoft sign-in failed. Check the app registration and account permissions, then try again.');
  }
}

type GraphEvent = { id: string; '@odata.etag'?: string; changeKey?: string; subject?: string; isAllDay?: boolean; isCancelled?: boolean; start?: { dateTime: string; timeZone: string }; end?: { dateTime: string; timeZone: string }; location?: { displayName?: string }; body?: { content?: string; contentType?: string }; webLink?: string; onlineMeeting?: { joinUrl?: string }; type?: string; attendees?: unknown[]; lastModifiedDateTime?: string };
export function normaliseMicrosoft(event: GraphEvent): RemoteEvent | null {
  if (event.isCancelled) return null;
  if (!event.id || !event.start || !event.end) throw new UserError('Microsoft returned an incomplete event. The cached calendar has been kept.');
  const instant = (time: NonNullable<GraphEvent['start']>) => {
    if (time.timeZone !== 'UTC' && time.timeZone !== 'Etc/UTC') throw new UserError('Microsoft returned an unexpected time zone. The cached calendar has been kept.');
    return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(time.dateTime) ? time.dateTime : time.dateTime + 'Z').toISOString();
  };
  return {
    googleId: event.id, etag: event['@odata.etag'] ?? event.changeKey ?? null, updated: event.lastModifiedDateTime ?? null,
    title: event.subject?.trim() || '(No title)', allDay: !!event.isAllDay,
    start: event.isAllDay ? event.start.dateTime.slice(0, 10) : instant(event.start),
    end: event.isAllDay ? event.end.dateTime.slice(0, 10) : instant(event.end),
    location: event.location?.displayName?.trim() || null, notes: event.body?.content || null,
    htmlLink: event.webLink ?? null, meetLink: event.onlineMeeting?.joinUrl ?? null,
    recurring: event.type === 'occurrence' || event.type === 'exception', hasGuests: !!event.attendees?.length,
  };
}
export function microsoftBody(fields: EventFields, timeZone: string) {
  const body: Record<string, unknown> = {};
  if (fields.title !== undefined) body.subject = fields.title;
  if (fields.location !== undefined) body.location = { displayName: fields.location ?? '' };
  if (fields.notes !== undefined) body.body = { contentType: 'text', content: fields.notes ?? '' };
  if (fields.times) {
    const times = storedTimes(fields.times, timeZone);
    body.isAllDay = times.allDay;
    body.start = { dateTime: times.allDay ? times.start + 'T00:00:00' : times.start.replace(/Z$/, ''), timeZone: 'UTC' };
    body.end = { dateTime: times.allDay ? times.end + 'T00:00:00' : times.end.replace(/Z$/, ''), timeZone: 'UTC' };
  }
  return body;
}
export function microsoftProvider(connection: MicrosoftConnection): Provider {
  async function request<T>(url: string, method = 'GET', body?: unknown, etag?: string): Promise<T | null> {
    const response = await calendarFetch(url, { method, headers: { authorization: `Bearer ${await microsoftAuth.accessToken(connection)}`, prefer: 'outlook.timezone="UTC", IdType="ImmutableId"', ...(body ? { 'content-type': 'application/json' } : {}), ...(etag ? { 'if-match': etag } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, (u) => u.origin === 'https://graph.microsoft.com' && u.pathname.startsWith('/v1.0/'));
    if (response.status === 404 || response.status === 410) return null;
    checkResponse(response);
    if (response.status === 204) return null;
    try { return JSON.parse(await boundedText(response)) as T; }
    catch (error) { if (error instanceof UserError) throw error; throw new UserError('Microsoft returned an unreadable response.', 502); }
  }
  async function pages<T>(url: string) {
    const out: T[] = [];
    for (let page = 0; url; page++) {
      if (page >= 1000) throw new UserError('This Microsoft calendar response is too large to import.');
      const response = await request<{ value: T[]; '@odata.nextLink'?: string }>(url);
      if (!response || !Array.isArray(response.value)) throw new UserError('Microsoft could not return this calendar.', 404);
      out.push(...response.value);
      if (out.length > 100_000) throw new UserError('This Microsoft calendar response is too large to import.');
      url = response['@odata.nextLink'] ?? '';
    }
    return out;
  }
  const eventsUrl = (id: string) => `${API}/me/calendars/${encodeURIComponent(id)}/events`;
  return {
    status: () => ({ id: connection.id, provider: 'microsoft', label: connection.label, configured: true, connected: !!cache(connection.id), account: cache(connection.id)?.username ?? null }),
    async listCalendars() {
      const calendars = await pages<{ id: string; name: string; hexColor?: string; isDefaultCalendar?: boolean; canEdit?: boolean }>(`${API}/me/calendars`);
      return calendars.map((c) => ({ id: c.id, name: c.name, color: c.hexColor && /^#[0-9a-f]{6}$/i.test(c.hexColor) ? c.hexColor : '#5b8def', primary: !!c.isDefaultCalendar, writable: !!c.canEdit, selected: true }));
    },
    async listEvents(id, from, to) { return (await pages<GraphEvent>(`${API}/me/calendars/${encodeURIComponent(id)}/calendarView?${new URLSearchParams({ startDateTime: from, endDateTime: to, '$top': '1000' })}`)).map(normaliseMicrosoft).filter((e): e is RemoteEvent => e !== null); },
    async insertEvent(id, fields, timeZone) {
      const result = await request<GraphEvent>(eventsUrl(id), 'POST', microsoftBody(fields, timeZone));
      const event = result && normaliseMicrosoft(result);
      if (!event) throw new UserError('Microsoft did not return the new event.', 502);
      return event;
    },
    async patchEvent(id, eventId, fields, timeZone) {
      const url = `${eventsUrl(id)}/${encodeURIComponent(eventId)}`;
      const before = await request<GraphEvent>(url);
      if (!before) return null;
      const result = await request<GraphEvent>(url, 'PATCH', microsoftBody(fields, timeZone), before['@odata.etag']);
      return result ? normaliseMicrosoft(result) : null;
    },
    async deleteEvent(id, eventId) {
      const url = `${eventsUrl(id)}/${encodeURIComponent(eventId)}`;
      const before = await request<GraphEvent>(url);
      if (before) await request(url, 'DELETE', undefined, before['@odata.etag']);
    },
  };
}
