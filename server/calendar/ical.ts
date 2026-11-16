import { createHash } from 'node:crypto';
import ical, { type VEvent, type ParameterValue, type DateWithTimeZone } from 'node-ical';
import { toLocal } from '../../shared/calendar/time.ts';
import { UserError } from '../errors.ts';
import type { RemoteEvent } from './provider.ts';

export const icalText = (value?: ParameterValue) => (typeof value === 'string' ? value : value?.val)?.trim() || null;
export const calendarDay = (value: DateWithTimeZone) => toLocal(value.toISOString(), value.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone).slice(0, 10);
export type IcalInstance = { event: RemoteEvent; uid: string; recurrenceId: string | null; source: VEvent };

/** Expand a complete response before any cached events are changed. */
export async function readIcalendar(text: string, from: string, to: string, timeZone: string): Promise<IcalInstance[]> {
  if (text.length > 5_000_000 || !/^BEGIN:VCALENDAR\r?$/m.test(text) || !/^END:VCALENDAR\r?$/m.test(text)) throw new UserError('The calendar service did not return a complete iCalendar file.');
  try {
    const declared = /^X-WR-TIMEZONE:(.+)\r?$/m.exec(text)?.[1]?.trim() ?? timeZone;
    new Intl.DateTimeFormat('en', { timeZone: declared });
    // Floating times belong to the calendar's zone, never the server's UTC clock.
    const source = text.replace(/^(DTSTART|DTEND|RECURRENCE-ID|EXDATE|RDATE)(;VALUE=DATE-TIME)?:([\dT,]+)(\r?)$/gm, (line, property: string, _type, value: string, cr: string) => value.includes('T') ? `${property};TZID=${declared}:${value}${cr}` : line);
    const parsed = await ical.async.parseICS(source);
    const out: IcalInstance[] = [];
    for (const entry of Object.values(parsed)) {
      if (!entry || entry.type !== 'VEVENT') continue;
      if (!entry.uid || !entry.start) throw new Error('Missing required event fields');
      if (entry.status === 'CANCELLED') continue;
      const occurrences = ical.expandRecurringEvent(entry, { from: new Date(from), to: new Date(to), expandOngoing: true, maxIterations: 10_000 });
      for (const occurrence of occurrences) {
        const actual = occurrence.event;
        if (actual.status === 'CANCELLED' || occurrence.start.toISOString() >= to || occurrence.end.toISOString() <= from) continue;
        const allDay = occurrence.isFullDay;
        const recurrenceDate = actual.recurrenceid ?? occurrence.start;
        const recurrenceId = occurrence.isRecurring || actual.recurrenceid ? (recurrenceDate.dateOnly || occurrence.isFullDay ? calendarDay(recurrenceDate) : recurrenceDate.toISOString()) : null;
        const event: RemoteEvent = {
          googleId: JSON.stringify([entry.uid, recurrenceId]), etag: null, updated: actual.lastmodified?.toISOString() ?? null,
          title: icalText(actual.summary) ?? '(No title)', allDay,
          start: allDay ? calendarDay(occurrence.start) : occurrence.start.toISOString(),
          end: allDay ? calendarDay(occurrence.end) : occurrence.end.toISOString(),
          location: icalText(actual.location), notes: icalText(actual.description),
          htmlLink: actual.url && /^https?:\/\//i.test(actual.url) ? actual.url : null,
          meetLink: null, recurring: recurrenceId !== null, hasGuests: !!actual.attendee,
        };
        event.etag = createHash('sha256').update(JSON.stringify(event)).digest('hex');
        out.push({ event, uid: entry.uid, recurrenceId, source: actual });
        if (out.length > 20_000) throw new Error('Too many occurrences');
      }
    }
    return out;
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('This calendar could not be parsed safely. Its dates, time zones or repeating events need checking. The previous events have been kept.');
  }
}
