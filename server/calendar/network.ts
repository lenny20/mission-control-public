import { UserError } from '../errors.ts';

export const calendarHttp = { fetch: (input: string, init?: RequestInit) => globalThis.fetch(input, init) };
/** Private subscription URLs and passwords must never appear in error messages. */
export async function calendarFetch(url: string, init: RequestInit = {}, allowed: (u: URL) => boolean = () => true, followRedirects = true): Promise<Response> {
  let target = new URL(url);
  for (let redirects = 0; redirects < 5; redirects++) {
    if (target.protocol !== 'https:' || target.username || target.password || !allowed(target)) throw new UserError('The calendar service redirected outside its permitted HTTPS server. Check its server address.');
    let response: Response;
    try { response = await calendarHttp.fetch(target.href, { ...init, redirect: 'manual', signal: AbortSignal.timeout(25_000) }); }
    catch { throw new UserError('Could not reach the calendar service. Nothing was changed locally.', 502); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!followRedirects) return response;
      const location = response.headers.get('location');
      if (!location) throw new UserError('The calendar service returned an incomplete redirect.', 502);
      target = new URL(location, target);
      continue;
    }
    return response;
  }
  throw new UserError('The calendar service redirected too many times.', 502);
}
export function checkResponse(response: Response) {
  if (response.status === 401) throw new UserError('The calendar service rejected the login. Reconnect this account.', 401);
  if (response.status === 403) throw new UserError('The calendar service does not allow this action. Check calendar permissions.', 403);
  if (response.status === 412 || response.status === 409) throw new UserError('This event changed on the calendar service. Sync and open it again before editing.', 409);
  if (!response.ok) throw new UserError(`The calendar service could not complete this request (HTTP ${response.status}).`, 502);
}
export async function boundedText(response: Response, maxBytes = 5_000_000) {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new UserError('This calendar response is too large to import safely.');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new UserError('This calendar response is too large to import safely.');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
