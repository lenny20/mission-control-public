import type { StoredConnection } from '../../shared/calendar/connections.ts';
import { UserError } from '../errors.ts';
import { readIcalendar } from './ical.ts';
import { boundedText, calendarFetch, checkResponse } from './network.ts';
import type { Provider } from './provider.ts';

export function subscriptionProvider(connection: Extract<StoredConnection, { provider: 'ics' }>, timeZone: string): Provider {
  const readOnly = async (): Promise<never> => { throw new UserError('Calendar subscriptions are read-only. Edit this event in its original calendar.', 403); };
  return {
    status: () => ({ id: connection.id, provider: 'ics', label: connection.label, account: null, configured: true, connected: true }),
    listCalendars: async () => [{ id: 'subscription', name: connection.label, color: '#9aa0c8', primary: false, writable: false, selected: true }],
    async listEvents(_id, from, to) {
      const response = await calendarFetch(connection.url, { headers: { accept: 'text/calendar' } }, (url) => url.origin === new URL(connection.url).origin);
      checkResponse(response);
      return (await readIcalendar(await boundedText(response), from, to, timeZone)).map(({ event }) => ({ ...event, writeProtected: true }));
    },
    insertEvent: readOnly, patchEvent: readOnly, deleteEvent: readOnly,
  };
}
