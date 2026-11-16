// The calendar's side column: quick add, a month to jump around in, and (from
// CalendarPage) the calendars with how the link with Google is doing.

import { useEffect, useMemo, useState } from 'react';
import { addDays, formatLong, formatMonthYear, weekStart, type DateStr } from '../../../shared/dates.ts';
import { parseQuick } from '../../../shared/calendar/quickAdd.ts';
import { openEvent } from '../../calendar/EventSheet.tsx';
import { useCalendar } from '../../calendar/store.ts';
import { colourOf, fmtTime, onDay, place } from '../../calendar/time.ts';
import { navigate, type CalView } from '../../lib/router.ts';
import { IconChevronLeft, IconChevronRight, IconPin, IconPlus } from '../../ui/icons.tsx';

/** Type an event the way you'd say it; Enter opens it, filled in, to check and save. */
export function QuickAdd({ today }: { today: DateStr }) {
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseQuick(text, today) : null;
  const open = () => {
    if (!parsed) return;
    openEvent({ draft: { title: parsed.title, date: parsed.date, start: parsed.start, end: parsed.end, allDay: parsed.allDay, location: parsed.location } });
    setText('');
  };
  const when = parsed
    ? `${formatLong(parsed.date)}${parsed.allDay ? ', all day' : parsed.start ? `, ${fmtTime(new Date(`${parsed.date}T${parsed.start}`))}${parsed.end ? ` to ${fmtTime(new Date(`${parsed.date}T${parsed.end}`))}` : ''}` : ''}`
    : null;
  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        open();
      }}
    >
      <label className="quick-field">
        <IconPlus />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Lunch with Sam tomorrow 1pm" aria-label="Quick add an event" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setText(''))} />
      </label>
      {parsed ? (
        <div className="quick-preview" aria-live="polite">
          <strong>{parsed.title}</strong>
          <span>{when}</span>
          {parsed.location ? (
            <span>
              <IconPin /> {parsed.location}
            </span>
          ) : null}
          <span className="faint">Enter to check and save</span>
        </div>
      ) : null}
    </form>
  );
}

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** A month to jump around in: days with something on carry a dot in its colour. */
export function MiniMonth({ anchor, today, view, colours }: { anchor: DateStr; today: DateStr; view: CalView; colours: Map<string, string> }) {
  const [month, setMonth] = useState(anchor.slice(0, 7));
  // Follow the main view when it moves to another month.
  useEffect(() => setMonth(anchor.slice(0, 7)), [anchor]);
  const from = weekStart(`${month}-01`);
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  const { data } = useCalendar(from, addDays(from, 42));
  const placed = useMemo(() => (data?.events ?? []).map(place), [data]);
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(t.toISOString().slice(0, 7));
  };
  // In week view the week on screen is shaded, so you can see where you are.
  const shown = view === 'week' ? [weekStart(anchor), addDays(weekStart(anchor), 6)] : ['', ''];

  return (
    <section className="mini" aria-label="Month">
      <div className="mini-head">
        <span className="mini-title">{formatMonthYear(`${month}-01`)}</span>
        <button className="mini-step" onClick={() => shift(-1)} aria-label="Previous month">
          <IconChevronLeft />
        </button>
        <button className="mini-step" onClick={() => shift(1)} aria-label="Next month">
          <IconChevronRight />
        </button>
      </div>
      <div className="mini-grid" role="grid">
        {DOW.map((d, i) => (
          <span key={i} className="mini-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const on = placed.filter((p) => onDay(p, d)).slice(0, 3);
          const inShown = d >= shown[0]! && d <= shown[1]!;
          return (
            <button
              key={d}
              className={`mini-day ${d.slice(0, 7) !== month ? 'other' : ''} ${d === today ? 'today' : ''} ${inShown ? 'shown' : ''}`}
              onClick={() => navigate({ area: 'calendar', view, date: d === today ? undefined : d })}
              aria-label={formatLong(d)}
            >
              <span className="num">{Number(d.slice(8))}</span>
              <span className="mini-dots" aria-hidden="true">
                {on.map((p) => (
                  <span key={p.ev.id} style={{ background: colourOf(p.ev, colours) }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
