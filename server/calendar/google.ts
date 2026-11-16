// Talking to Google Calendar: the login (OAuth for an installed app, with
// PKCE) and the handful of API calls the dashboard needs. Plain fetch, no SDK.

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EventInput } from '../../shared/calendar/schemas.ts';
import { paths } from '../config.ts';
import { UserError } from '../errors.ts';
import { storedTimes, type GoogleEvent } from './repo.ts';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
// Read the calendar list; read and write events. Nothing else.
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'];

/** Swappable in tests. */
export const http = { fetch: (input: string, init?: RequestInit) => globalThis.fetch(input, init) };

/** The login is gone or was refused: only connecting again fixes it. */
export class GoogleAuthError extends UserError {
  constructor(message = 'Google signed the dashboard out. Connect again from the Calendar screen.') {
    super(message, 401);
  }
}

// ------------------------------------------------------------------ files

type Client = { clientId: string; clientSecret: string };
type Token = { refreshToken: string; account: string | null };

export function readClient(): Client | null {
  if (!existsSync(paths.googleClient)) return null;
  try {
    const json = JSON.parse(readFileSync(paths.googleClient, 'utf8')) as Record<string, { client_id?: string; client_secret?: string }>;
    const c = json.installed ?? json.web;
    return c?.client_id && c.client_secret ? { clientId: c.client_id, clientSecret: c.client_secret } : null;
  } catch {
    return null;
  }
}

export function readToken(): Token | null {
  if (!existsSync(paths.googleToken)) return null;
  try {
    const t = JSON.parse(readFileSync(paths.googleToken, 'utf8')) as Partial<Token>;
    return t.refreshToken ? { refreshToken: t.refreshToken, account: t.account ?? null } : null;
  } catch {
    return null;
  }
}

function writeToken(t: Token) {
  mkdirSync(path.dirname(paths.googleToken), { recursive: true });
  writeFileSync(paths.googleToken, JSON.stringify(t, null, 2), { mode: 0o600 });
  chmodSync(paths.googleToken, 0o600);
}

export function forgetToken() {
  rmSync(paths.googleToken, { force: true });
  access = null;
}

// ------------------------------------------------------------------ login

const pending = new Map<string, { verifier: string; redirectUri: string; at: number }>();

/** Where to send the browser to sign in. */
export function authUrl(redirectUri: string): string {
  const client = readClient();
  if (!client) throw new UserError('The Google client file is missing. See the setup steps on the Calendar screen.');
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60_000) pending.delete(k);
  const state = randomBytes(16).toString('hex');
  const verifier = randomBytes(48).toString('base64url');
  pending.set(state, { verifier, redirectUri, at: Date.now() });
  const q = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // Always ask, so Google always hands back a refresh token.
    prompt: 'consent',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${q}`;
}

/** Finish the login Google redirected back from, and save it. Returns the account's email. */
export async function finishLogin(code: string, state: string): Promise<string> {
  const p = pending.get(state);
  pending.delete(state);
  if (!p) throw new UserError('That sign-in link has expired. Start again from the Calendar screen.');
  const client = readClient();
  if (!client) throw new UserError('The Google client file is missing.');
  const res = await tokenRequest({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    code_verifier: p.verifier,
    redirect_uri: p.redirectUri,
    grant_type: 'authorization_code',
  }).catch((err: unknown) => {
    throw err instanceof GoogleAuthError ? new UserError("Google didn't accept the sign-in. Try connecting again.") : err;
  });
  if (!res.refresh_token) throw new UserError("Google didn't return a lasting login. Try connecting again.");
  access = { token: res.access_token, expiresAt: Date.now() + (res.expires_in - 60) * 1000 };
  writeToken({ refreshToken: res.refresh_token, account: null });
  const primary = (await listCalendars()).find((c) => c.primary);
  const account = primary?.id ?? null;
  writeToken({ refreshToken: res.refresh_token, account });
  return account ?? 'your Google account';
}

let access: { token: string; expiresAt: number } | null = null;

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  let res: Response;
  try {
    res = await http.fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  } catch {
    throw offline();
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string; access_token?: string; expires_in?: number; refresh_token?: string };
  if (!res.ok || !json.access_token) {
    if (json.error === 'invalid_grant' || json.error === 'invalid_client' || json.error === 'unauthorized_client') throw new GoogleAuthError();
    throw new UserError(`Google refused the sign-in: ${json.error_description ?? json.error ?? res.status}.`, 502);
  }
  return { access_token: json.access_token, expires_in: json.expires_in ?? 3600, refresh_token: json.refresh_token };
}

async function accessToken(): Promise<string> {
  if (access && Date.now() < access.expiresAt) return access.token;
  const client = readClient();
  const token = readToken();
  if (!client || !token) throw new GoogleAuthError('Google Calendar is not connected.');
  const res = await tokenRequest({ client_id: client.clientId, client_secret: client.clientSecret, refresh_token: token.refreshToken, grant_type: 'refresh_token' });
  access = { token: res.access_token, expiresAt: Date.now() + (res.expires_in - 60) * 1000 };
  return access.token;
}

// ------------------------------------------------------------------ API calls

const offline = () => new UserError("Couldn't reach Google, so nothing changed. Check the internet connection and try again.", 502);

/** One API call. 404 and 410 come back as null so callers can treat "already gone" as done. */
async function call<T>(method: string, url: string, body?: unknown, retried = false): Promise<T | null> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await http.fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw offline();
  }
  if (res.status === 401 && !retried) {
    access = null;
    return call<T>(method, url, body, true);
  }
  if (res.status === 401) throw new GoogleAuthError();
  if (res.status === 404 || res.status === 410) return null;
  if (res.status === 204) return {} as T;
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
  if (res.ok) return json as T;
  const reason = json.error?.errors?.[0]?.reason;
  if (res.status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') throw new UserError('Google is busy right now. Try again in a minute.', 503);
  if (res.status === 403) throw new UserError("Google won't allow that. You may only have view access to this event or calendar.", 403);
  throw new UserError(`Google said: ${json.error?.message ?? `error ${res.status}`}`, 502);
}

type GCalendar = { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean; accessRole?: string; selected?: boolean };

export async function listCalendars() {
  const out: GCalendar[] = [];
  let page: string | undefined;
  do {
    const q = new URLSearchParams({ maxResults: '250', ...(page ? { pageToken: page } : {}) });
    const res = await call<{ items?: GCalendar[]; nextPageToken?: string }>('GET', `${API}/users/me/calendarList?${q}`);
    out.push(...(res?.items ?? []));
    page = res?.nextPageToken;
  } while (page);
  return out.map((c) => ({
    id: c.id,
    name: c.summaryOverride ?? c.summary ?? c.id,
    color: c.backgroundColor ?? '#9aa0c8',
    primary: !!c.primary,
    writable: c.accessRole === 'owner' || c.accessRole === 'writer',
    selected: !!c.selected,
  }));
}

type GTime = { date?: string; dateTime?: string; timeZone?: string };
type GEvent = {
  id: string;
  status?: string;
  etag?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GTime;
  end?: GTime;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  recurringEventId?: string;
  attendees?: { self?: boolean; resource?: boolean }[];
};

/** Google's event, in our columns. Cancelled ones and ones without times come back null. */
export function normalise(e: GEvent): GoogleEvent | null {
  if (e.status === 'cancelled' || !e.start || !e.end) return null;
  const allDay = !!e.start.date;
  const start = allDay ? e.start.date : e.start.dateTime && new Date(e.start.dateTime).toISOString();
  const end = allDay ? e.end.date : e.end.dateTime && new Date(e.end.dateTime).toISOString();
  if (!start || !end) return null;
  return {
    googleId: e.id,
    etag: e.etag ?? null,
    updated: e.updated ?? null,
    title: e.summary?.trim() || '(No title)',
    allDay,
    start,
    end,
    location: e.location?.trim() || null,
    notes: e.description?.trim() || null,
    htmlLink: e.htmlLink ?? null,
    meetLink: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? null,
    recurring: !!e.recurringEventId,
    hasGuests: !!e.attendees?.some((a) => !a.self && !a.resource),
  };
}

const enc = encodeURIComponent;

/** Every event overlapping [timeMin, timeMax), repeats expanded into single days. */
export async function listEvents(calendarId: string, timeMin: string, timeMax: string): Promise<GoogleEvent[]> {
  const out: GoogleEvent[] = [];
  let page: string | undefined;
  do {
    const q = new URLSearchParams({ singleEvents: 'true', timeMin, timeMax, maxResults: '2500', ...(page ? { pageToken: page } : {}) });
    const res = await call<{ items?: GEvent[]; nextPageToken?: string }>('GET', `${API}/calendars/${enc(calendarId)}/events?${q}`);
    if (!res) throw new UserError('Google says that calendar no longer exists.', 404);
    for (const item of res.items ?? []) {
      const n = normalise(item);
      if (n) out.push(n);
    }
    page = res.nextPageToken;
  } while (page);
  return out;
}

type Fields = Partial<Pick<EventInput, 'title' | 'location' | 'notes'>> & { times?: Pick<EventInput, 'allDay' | 'start' | 'end'> };

/** A Google event body holding only the fields given, so a change never touches the rest. */
export function body(f: Fields, timeZone: string): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  if (f.title !== undefined) b.summary = f.title;
  if (f.location !== undefined) b.location = f.location ?? '';
  if (f.notes !== undefined) b.description = f.notes ?? '';
  if (f.times) {
    const s = storedTimes(f.times, timeZone);
    // Setting one kind clears the other, so a timed event can become all-day and back.
    b.start = s.allDay ? { date: s.start, dateTime: null, timeZone: null } : { dateTime: s.start, timeZone, date: null };
    b.end = s.allDay ? { date: s.end, dateTime: null, timeZone: null } : { dateTime: s.end, timeZone, date: null };
  }
  return b;
}

export async function insertEvent(calendarId: string, fields: Required<Omit<Fields, 'times'>> & { times: NonNullable<Fields['times']> }, timeZone: string): Promise<GoogleEvent> {
  const res = await call<GEvent>('POST', `${API}/calendars/${enc(calendarId)}/events`, body(fields, timeZone));
  const n = res && normalise(res);
  if (!n) throw new UserError("Google didn't accept the event.", 502);
  return n;
}

/** Change an event. Null when Google no longer has it. */
export async function patchEvent(calendarId: string, googleId: string, fields: Fields, timeZone: string): Promise<GoogleEvent | null> {
  const res = await call<GEvent>('PATCH', `${API}/calendars/${enc(calendarId)}/events/${enc(googleId)}`, body(fields, timeZone));
  return res ? normalise(res) : null;
}

/** Delete an event. Already gone counts as done. */
export async function deleteEvent(calendarId: string, googleId: string): Promise<void> {
  await call('DELETE', `${API}/calendars/${enc(calendarId)}/events/${enc(googleId)}`);
}
