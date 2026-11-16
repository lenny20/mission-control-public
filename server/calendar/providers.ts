import * as google from './google.ts';
import { listConnections } from './connections.ts';
import { microsoftProvider } from './microsoft.ts';
import { caldavProvider } from './caldav.ts';
import { subscriptionProvider } from './subscription.ts';
import type { Provider } from './provider.ts';

export function calendarProviders(timeZone: string): Provider[] {
  const primary: Provider = {
    status: () => ({ id: 'google', provider: 'google', label: 'Google Calendar', configured: google.readClient() !== null, connected: google.readToken() !== null, account: google.readToken()?.account ?? null }),
    listCalendars: google.listCalendars, listEvents: google.listEvents,
    insertEvent: google.insertEvent, patchEvent: google.patchEvent, deleteEvent: google.deleteEvent,
  };
  return [primary, ...listConnections().map((c) => c.provider === 'microsoft' ? microsoftProvider(c) : c.provider === 'ics' ? subscriptionProvider(c, timeZone) : caldavProvider(c, timeZone))];
}
