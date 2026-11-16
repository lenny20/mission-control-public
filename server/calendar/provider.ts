import type { ConnectionStatus } from '../../shared/calendar/connections.ts';
import type { EventInput } from '../../shared/calendar/schemas.ts';
import type { CalendarInfo } from '../../shared/calendar/types.ts';
import type { GoogleEvent } from './repo.ts';

export type RemoteCalendar = Omit<CalendarInfo, 'shown' | 'connectionId'> & { selected: boolean };
export type EventFields = Partial<Pick<EventInput, 'title' | 'location' | 'notes'>> & { times?: Pick<EventInput, 'allDay' | 'start' | 'end'> };
export type NewEventFields = Required<Omit<EventFields, 'times'>> & { times: NonNullable<EventFields['times']> };
/** The old Google storage column names remain compatible with existing databases. */
export type RemoteEvent = GoogleEvent;
export type Provider = {
  status(): Omit<ConnectionStatus, 'lastSync' | 'error'>;
  listCalendars(): Promise<RemoteCalendar[]>;
  listEvents(calendarId: string, from: string, to: string): Promise<RemoteEvent[]>;
  insertEvent(calendarId: string, fields: NewEventFields, timeZone: string): Promise<RemoteEvent>;
  patchEvent(calendarId: string, eventId: string, fields: EventFields, timeZone: string): Promise<RemoteEvent | null>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
};
