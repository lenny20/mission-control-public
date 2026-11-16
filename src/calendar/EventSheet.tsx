// The event drawer: new events and edits. Any screen opens it with `openEvent`.

import { useMemo, useState, useSyncExternalStore } from 'react';
import { addDays, daysBetween, formatLong, type DateStr } from '../../shared/dates.ts';
import { lastDay } from '../../shared/calendar/schemas.ts';
import type { CalEvent, CalendarStatus } from '../../shared/calendar/types.ts';
import { api } from '../lib/api.ts';
import { IconExternal, IconRepeat, IconVideo } from '../ui/icons.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { toast } from '../ui/toast.tsx';
import { confirmAction } from '../ui/confirm.tsx';
import { calMutate, useCalendarStatus } from './store.ts';
import { localDate, localTime, plainNotes } from './time.ts';

export type EventEditor = { event: CalEvent } | { draft: { date: DateStr; start?: string; end?: string; endDate?: DateStr; allDay?: boolean; title?: string; location?: string } };

let current: EventEditor | null = null;
const subs = new Set<() => void>();
export function openEvent(e: EventEditor | null) {
  // A card's deadline opens the card on its board.
  if (e && 'event' in e && e.event.source === 'work') {
    window.location.hash = e.event.htmlLink!;
    return;
  }
  current = e;
  subs.forEach((s) => s());
}

export function EventHost() {
  const editor = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => current,
  );
  const status = useCalendarStatus();
  if (!editor) return null;
  const key = 'event' in editor ? `e${editor.event.id}` : `n${JSON.stringify(editor.draft)}`;
  return <EventSheet key={key} editor={editor} status={status} onClose={() => openEvent(null)} />;
}

type Draft = {
  title: string;
  allDay: boolean;
  startDate: DateStr;
  startTime: string;
  endDate: DateStr;
  endTime: string;
  location: string;
  notes: string;
  calendarId: string;
};

function fromEvent(ev: CalEvent): Draft {
  const s = new Date(ev.start);
  const e = new Date(ev.end);
  return {
    title: ev.title,
    allDay: ev.allDay,
    startDate: ev.allDay ? ev.start : localDate(s),
    startTime: ev.allDay ? '09:00' : localTime(s),
    endDate: ev.allDay ? lastDay(ev.end) : localDate(e),
    endTime: ev.allDay ? '10:00' : localTime(e),
    location: ev.location ?? '',
    notes: plainNotes(ev.notes),
    calendarId: ev.calendarId ?? '',
  };
}

const toMinutes = (date: DateStr, time: string) => daysBetween('2000-01-01', date) * 1440 + Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
function fromMinutes(m: number): [DateStr, string] {
  const days = Math.floor(m / 1440);
  const rest = m - days * 1440;
  return [addDays('2000-01-01', days), `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`];
}

const payloadTimes = (d: Draft) =>
  d.allDay ? { start: d.startDate, end: d.endDate } : { start: `${d.startDate}T${d.startTime}`, end: `${d.endDate}T${d.endTime}` };

function EventSheet({ editor, status, onClose }: { editor: EventEditor; status: CalendarStatus | null; onClose: () => void }) {
  const existing = 'event' in editor ? editor.event : null;
  const initial = useMemo<Draft>(() => {
    if (existing) return fromEvent(existing);
    const d = (editor as Extract<EventEditor, { draft: unknown }>).draft;
    const start = d.start ?? '09:00';
    const [endDate, endTime] = d.end ? [d.endDate ?? d.date, d.end] : fromMinutes(toMinutes(d.date, start) + 60);
    return { title: d.title ?? '', allDay: !!d.allDay, startDate: d.date, startTime: start, endDate: d.allDay ? (d.endDate ?? d.date) : endDate, endTime, location: d.location ?? '', notes: '', calendarId: '' };
  }, [editor, existing]);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const calendars = status?.calendars ?? [];
  const cal = existing?.calendarId ? calendars.find((c) => c.id === existing.calendarId) : null;
  const readOnly = !!existing?.writeProtected || (!!existing?.calendarId && !cal?.writable);
  const destinations = calendars.filter((c) => c.writable && ((c.connectionId ?? 'google') !== 'google' || c.primary));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  // Moving the start keeps the length, as in every calendar app.
  const moveStart = (date: DateStr, time: string) => {
    setDraft((d) => {
      if (d.allDay) return { ...d, startDate: date, endDate: addDays(date, Math.max(0, daysBetween(d.startDate, d.endDate))) };
      const length = toMinutes(d.endDate, d.endTime) - toMinutes(d.startDate, d.startTime);
      const [endDate, endTime] = fromMinutes(toMinutes(date, time) + Math.max(15, length));
      return { ...d, startDate: date, startTime: time, endDate, endTime };
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || busy) return;
    setError(null);
    setBusy(true);
    try {
      if (!existing) {
        await calMutate(() => api.post('/api/calendar/events', { title: draft.title, ...payloadTimes(draft), location: draft.location || null, notes: draft.notes || null, calendarId: draft.calendarId || null }));
        toast(draft.calendarId ? 'Event added to the selected calendar' : 'Event added');
      } else {
        const patch: Record<string, unknown> = {};
        if (draft.title !== initial.title) patch.title = draft.title;
        if (draft.location !== initial.location) patch.location = draft.location || null;
        if (draft.notes !== initial.notes) patch.notes = draft.notes || null;
        const times = payloadTimes(draft);
        const before = payloadTimes(initial);
        if (times.start !== before.start || times.end !== before.end) Object.assign(patch, times);
        if (draft.calendarId && !initial.calendarId) patch.calendarId = draft.calendarId;
        if (Object.keys(patch).length) {
          await calMutate(() => api.put(`/api/calendar/events/${existing.id}`, patch));
          toast(patch.calendarId ? 'Saved, and added to the selected calendar' : 'Event saved');
        }
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    const shared = cal && !cal.primary;
    const guests = !!cal && existing.hasGuests;
    const body = shared
      ? `It's removed from ${cal.name} for everyone who shares that calendar.`
      : guests
        ? 'Other people are invited, so it can be removed for them too.'
        : cal
        ? "It's removed from its calendar service too."
        : undefined;
    if (!(await confirmAction({ title: `Delete “${existing.title}”?`, body }))) return;
    setBusy(true);
    try {
      await calMutate(() => api.del(`/api/calendar/events/${existing.id}${shared || guests ? '?confirmed=1' : ''}`));
      toast('Event deleted');
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const subtitle = existing ? (
    <span className="ev-where">
      <span className="dot" style={{ background: cal?.color ?? 'var(--cal-local)' }} />
      {cal ? cal.name : 'Dashboard only'}
      {existing.htmlLink ? (
        <a className="link-btn" href={existing.htmlLink} target="_blank" rel="noreferrer">
          Open in Google <IconExternal />
        </a>
      ) : null}
    </span>
  ) : undefined;

  return (
    <Sheet
      title={readOnly ? existing!.title : existing ? 'Edit event' : 'New event'}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        readOnly ? (
          <button className="btn" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            {existing ? (
              <button className="btn btn-danger" type="button" onClick={remove} disabled={busy}>
                Delete
              </button>
            ) : null}
            <span className="spacer" />
            <button className="btn btn-quiet" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" form="event-form" disabled={busy}>
              {existing ? 'Save' : 'Add event'}
            </button>
          </>
        )
      }
    >
      <form id="event-form" className="ev-form" onSubmit={save}>
        {existing?.meetLink ? (
          <a className="btn ev-join" href={existing.meetLink} target="_blank" rel="noreferrer">
            <IconVideo /> Join video call
          </a>
        ) : null}
        {readOnly ? <p className="muted">You can view {cal?.name ?? 'this calendar'} but not change it.</p> : null}
        <fieldset disabled={readOnly} className="ev-fields">
          <label className="field ev-title-field">
            <span className="visually-hidden">Title</span>
            <input className="ev-title-input" placeholder="Add a title" value={draft.title} onChange={(e) => set({ title: e.target.value })} autoFocus={!existing} required />
          </label>

          <label className="switch">
            <input type="checkbox" checked={draft.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
            <span className="switch-track" aria-hidden="true" />
            All day
          </label>

          <div className={`ev-when ${draft.allDay ? 'all-day' : ''}`}>
            <span className="ev-when-label">Starts</span>
            <input className="input" type="date" aria-label="Start date" value={draft.startDate} onChange={(e) => e.target.value && moveStart(e.target.value, draft.startTime)} required />
            {draft.allDay ? null : <input className="input" type="time" aria-label="Start time" step={300} value={draft.startTime} onChange={(e) => e.target.value && moveStart(draft.startDate, e.target.value)} required />}
            <span className="ev-when-label">Ends</span>
            <input className="input" type="date" aria-label="End date" value={draft.endDate} min={draft.startDate} onChange={(e) => e.target.value && set({ endDate: e.target.value })} required />
            {draft.allDay ? null : <input className="input" type="time" aria-label="End time" step={300} value={draft.endTime} onChange={(e) => e.target.value && set({ endTime: e.target.value })} required />}
          </div>
          <p className="faint small ev-when-text">{describeWhen(draft)}</p>

          {existing?.recurring ? (
            <p className="ev-note">
              <IconRepeat /> This repeats. Changes here apply to this one only.
            </p>
          ) : null}

          <label className="field">
            <span>Location</span>
            <input value={draft.location} onChange={(e) => set({ location: e.target.value })} />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea rows={4} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>

          {!existing?.calendarId ? (
            <label className="field">
              <span>Save to</span>
              <select value={draft.calendarId} onChange={(e) => set({ calendarId: e.target.value })}>
                <option value="">Dashboard only</option>
                {destinations.map((c) => <option key={c.id} value={c.id}>{c.name} — {status?.connections?.find((a) => a.id === (c.connectionId ?? 'google'))?.label ?? 'Google Calendar'}</option>)}
              </select>
              <small>Choose a connected calendar to save there as well. Subscriptions are read-only.</small>
            </label>
          ) : null}
        </fieldset>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

/** The chosen time in words, so a typo in a date field is obvious. */
function describeWhen(d: Draft): string {
  if (d.allDay) {
    const n = daysBetween(d.startDate, d.endDate) + 1;
    return n <= 1 ? `All day ${formatLong(d.startDate)}` : `${n} days, ${formatLong(d.startDate)} to ${formatLong(d.endDate)}`;
  }
  const mins = toMinutes(d.endDate, d.endTime) - toMinutes(d.startDate, d.startTime);
  if (mins <= 0) return 'The end is before the start.';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const length = [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
  return `${formatLong(d.startDate)}${d.endDate !== d.startDate ? ` to ${formatLong(d.endDate)}` : ''}, ${length}`;
}
