import { z } from 'zod';

export const PROVIDER_LABELS = { google: 'Google Calendar', microsoft: 'Outlook / Microsoft 365', icloud: 'Apple iCloud', yahoo: 'Yahoo Calendar', fastmail: 'Fastmail', caldav: 'CalDAV', ics: 'Calendar subscription' } as const;
export type ProviderKind = keyof typeof PROVIDER_LABELS;
export const httpsUrl = z.string().trim().max(4000).transform((s) => s.replace(/^webcal:/i, 'https:')).refine((s) => {
  try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password && !u.hash; } catch { return false; }
}, 'Use a complete HTTPS calendar address without an embedded username or password.');
const label = z.string().trim().min(1).max(80);
const login = { username: z.string().trim().min(1).max(320), password: z.string().min(1).max(1000) };
export const connectionInput = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('microsoft'), label, clientId: z.string().uuid(), tenant: z.string().regex(/^(common|organizations|consumers|[0-9a-f-]{36})$/i).default('common') }).strict(),
  z.object({ provider: z.literal('icloud'), label, ...login }).strict(),
  z.object({ provider: z.literal('yahoo'), label, ...login }).strict(),
  z.object({ provider: z.literal('fastmail'), label, ...login }).strict(),
  z.object({ provider: z.literal('caldav'), label, url: httpsUrl, ...login }).strict(),
  z.object({ provider: z.literal('ics'), label, url: httpsUrl }).strict(),
]);
export type ConnectionInput = z.infer<typeof connectionInput>;
export type StoredConnection = ConnectionInput & { id: string };
export type ConnectionStatus = { id: string; provider: ProviderKind; label: string; configured: boolean; connected: boolean; account: string | null; lastSync: string | null; error: string | null };
