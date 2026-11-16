import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDays, daysBetween, formatDow, formatLong, formatMonthYear, formatShort, weekStart, weekday, type DateStr } from '../../../shared/dates.ts';
import type { CalEvent, CalendarStatus } from '../../../shared/calendar/types.ts';
import { openEvent } from '../../calendar/EventSheet.tsx';
import { calMutate, requestSync, useCalendar } from '../../calendar/store.ts';
import { colourOf, daySpan, fmtRange, fmtTime, localDate, onDay, place, sortPlaced, type Placed } from '../../calendar/time.ts';
import { api } from '../../lib/api.ts';
import { useKey } from '../../lib/hooks.ts';
import { CAL_VIEWS, href, navigate, type CalView } from '../../lib/router.ts';
import { IconChevronLeft, IconChevronRight, IconPin, IconPlus, IconRepeat, IconVideo } from '../../ui/icons.tsx';
import { toast } from '../../ui/toast.tsx';
import { MiniMonth, QuickAdd } from './CalendarSide.tsx';

const formatWeekday = (d: DateStr) => formatLong(d).split(' ')[0]!;
const formatMonth = (d: DateStr) => formatLong(d).split(' ').at(-1)!;

/** A new event starts at the next whole hour today, or 9 am on another day. */
export function newDraft(date: DateStr, today: DateStr, now = new Date()) {
  if (date !== today || now.getHours() >= 23) return { date };
  return { date, start: `${String(now.getHours() + 1).padStart(2, '0')}:00` };
}

const VIEW_LABELS: Record<CalView, string> = { week: 'Week', month: 'Month', agenda: 'Agenda' };
const AGENDA_DAYS = 30;

function rangeFor(view: CalView, anchor: DateStr): [DateStr, DateStr] {
  if (view === 'week') {
    const s = weekStart(anchor);
    return [s, addDays(s, 7)];
  }
  if (view === 'month') {
    const s = weekStart(`${anchor.slice(0, 7)}-01`);
    return [s, addDays(s, 42)];
  }
  return [anchor, addDays(anchor, AGENDA_DAYS)];
}

function step(view: CalView, anchor: DateStr, dir: 1 | -1): DateStr {
  if (view === 'week') return addDays(anchor, 7 * dir);
  if (view === 'agenda') return addDays(anchor, AGENDA_DAYS * dir);
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const t = new Date(Date.UTC(y, m - 1 + dir, 1));
  return t.toISOString().slice(0, 10);
}

function periodLabel(view: CalView, anchor: DateStr): string {
  if (view === 'month') return formatMonthYear(anchor);
  if (view === 'agenda') return `From ${formatLong(anchor)}`;
  const s = weekStart(anchor);
  const e = addDays(s, 6);
  const year = e.slice(0, 4);
  if (s.slice(0, 7) === e.slice(0, 7)) return `${Number(s.slice(8))} – ${Number(e.slice(8))} ${formatMonthYear(e)}`;
  return `${formatShort(s)} – ${formatShort(e)} ${year}`;
}

/** Ticks once a minute so the now-line and "in 20 min" stay true. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function CalendarPage({ view, date, today }: { view: CalView; date?: DateStr; today: DateStr }) {
  const anchor = date ?? today;
  const [from, to] = rangeFor(view, anchor);
  const { data, error } = useCalendar(from, to);
  const status = data?.status ?? null;
  // New events land on today when it's on screen, otherwise on the day being looked at.
  const newDate = from <= today && today < to ? today : view === 'month' ? `${anchor.slice(0, 7)}-01` : anchor;
  const go = (d: DateStr | undefined, v: CalView = view) => navigate({ area: 'calendar', view: v, date: d && d !== today ? d : undefined });

  // Pull from Google when the calendar opens and whenever the window comes back into focus.
  useEffect(() => {
    const sync = () => void requestSync().catch(() => {});
    sync();
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);

  const sheetOpen = () => !!document.querySelector('.sheet');
  useKey('ArrowLeft', () => !sheetOpen() && go(step(view, anchor, -1)));
  useKey('ArrowRight', () => !sheetOpen() && go(step(view, anchor, 1)));
  useKey('t', () => !sheetOpen() && go(undefined));
  useKey('w', () => !sheetOpen() && go(date, 'week'));
  useKey('m', () => !sheetOpen() && go(date, 'month'));
  useKey('a', () => !sheetOpen() && go(date, 'agenda'));
  useKey('n', (e) => {
    if (sheetOpen()) return;
    e.preventDefault();
    openEvent({ draft: newDraft(newDate, today) });
  });

  const colours = useMemo(() => new Map((status?.calendars ?? []).map((c) => [c.id, c.color])), [status]);
  const placed = useMemo(() => (data?.events ?? []).map(place).sort(sortPlaced), [data]);

  return (
    <div className="page cal-page">
      <header className="page-head cal-top">
        <div className="cal-top-left">
          <h1 className="page-title cal-period">{periodLabel(view, anchor)}</h1>
          <div className="cal-step">
            <a className="btn btn-quiet icon-btn" href={href({ area: 'calendar', view, date: step(view, anchor, -1) })} aria-label="Previous" title="Previous (←)">
              <IconChevronLeft />
            </a>
            <a className="btn btn-sm" href={href({ area: 'calendar', view })} title="Today (T)">
              Today
            </a>
            <a className="btn btn-quiet icon-btn" href={href({ area: 'calendar', view, date: step(view, anchor, 1) })} aria-label="Next" title="Next (→)">
              <IconChevronRight />
            </a>
          </div>
        </div>
        <div className="cal-top-right">
          <div className="segmented" role="group" aria-label="View">
            {CAL_VIEWS.map((v) => (
              <a key={v} className="seg-link" href={href({ area: 'calendar', view: v, date })} aria-pressed={v === view} title={`${VIEW_LABELS[v]} (${v[0]!.toUpperCase()})`}>
                {VIEW_LABELS[v]}
              </a>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => openEvent({ draft: newDraft(newDate, today) })} title="New event (N)">
            <IconPlus /> New event
          </button>
        </div>
      </header>

      <div className="cal-layout">
        <aside className="cal-side" aria-label="Calendar tools">
          <QuickAdd today={today} />
          <MiniMonth anchor={anchor} today={today} view={view} colours={colours} />
          <GoogleBar status={status} />
        </aside>
        <div className="cal-main">
          {error && !data ? (
            <div className="empty">
              <strong>The calendar couldn't load.</strong>
              {error}
            </div>
          ) : view === 'week' ? (
            <WeekView from={from} today={today} placed={placed} colours={colours} />
          ) : view === 'month' ? (
            <MonthView from={from} month={anchor.slice(0, 7)} today={today} placed={placed} colours={colours} />
          ) : (
            <AgendaView from={from} today={today} placed={placed} colours={colours} loaded={!!data} />
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Google status and calendars

function GoogleBar({ status }: { status: CalendarStatus | null }) {
  if (!status) return <div className="cal-bar" />;
  if (!status.configured) {
    return (
      <div className="cal-connect">
        <div>
          <strong>Google Calendar isn't set up yet.</strong>
          <p className="muted">Events you add are saved here. Once the Google client file is in place, your Google calendars show up here too.</p>
        </div>
      </div>
    );
  }
  if (!status.connected) {
    return (
      <div className="cal-connect">
        <div>
          <strong>Connect Google Calendar</strong>
          <p className="muted">Shows your Google calendars here, and lets you add events to Google from the dashboard.</p>
        </div>
        <a className="btn btn-primary" href="/api/google/connect">
          Connect
        </a>
      </div>
    );
  }
  const needsLogin = !!status.error && /connect again|not connected|sign-in/i.test(status.error);
  const toggle = async (id: string, shown: boolean) => {
    try {
      await calMutate(() => api.put(`/api/calendar/calendars/${encodeURIComponent(id)}`, { shown }));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <div className="cal-bar">
      <ul className="cal-cals" aria-label="Calendars">
        <li>
          <span className="cal-chip static">
            <span className="cal-swatch" style={{ background: 'var(--cal-local)' }} />
            Dashboard
          </span>
        </li>
        <li>
          <span className="cal-chip static" title="Due dates from the Work boards">
            <span className="cal-swatch" style={{ background: 'var(--cal-deadline)' }} />
            Deadlines
          </span>
        </li>
        {status.calendars.map((c) => (
          <li key={c.id}>
            <button className="cal-chip" aria-pressed={c.shown} onClick={() => void toggle(c.id, !c.shown)} title={c.shown ? `Hide ${c.name}` : `Show ${c.name}`}>
              <span className="cal-swatch" style={{ background: c.shown ? c.color : 'transparent', borderColor: c.color }} />
              {c.name}
            </button>
          </li>
        ))}
      </ul>
      <p className={`cal-sync ${status.error ? 'bad' : ''}`}>
        {status.error ? (
          <>
            {status.error}{' '}
            {needsLogin ? (
              <a className="link-btn" href="/api/google/connect">
                Connect again
              </a>
            ) : (
              <button className="link-btn" onClick={() => void requestSync(true).catch((e: Error) => toast(e.message, 'error'))}>
                Try again
              </button>
            )}
          </>
        ) : status.lastSync ? (
          <span title={`Last pulled from Google at ${new Date(status.lastSync).toLocaleTimeString('en-AU')}`}>Up to date with Google</span>
        ) : (
          'Pulling from Google…'
        )}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ shared pieces

function eventStyle(ev: CalEvent, colours: Map<string, string>): React.CSSProperties {
  return { '--ev': colourOf(ev, colours) } as React.CSSProperties;
}

function timeLabel(p: Placed): string {
  if (p.lane === 'allday') return 'All day';
  return fmtRange(p.start, p.end);
}

// ------------------------------------------------------------------ week

const HOUR = 48;
const SNAP = 15;
// Each text line in an event block is 16px plus a 1px gap, and the block has
// 2px of spacing and 8px of padding (.ev-block in calendar.css).
const LINE = 17;

/**
 * What fits in a block this tall, so nothing is cut off mid-line. In order:
 * one title line, the time, a second title line, the location, a third title line.
 */
function blockLines(height: number, hasLocation: boolean): { title: number; location: boolean } {
  let room = height - 10 - LINE;
  const title = room >= 2 * LINE ? 2 : 1;
  room -= title * LINE;
  const location = hasLocation && room >= LINE;
  if (location) room -= LINE;
  return { title: title === 2 && room >= LINE ? 3 : title, location };
}
/**
 * Clock minutes into a day, matching the hour labels. Measured by the clock,
 * not elapsed time, so daylight-saving days don't shift everything an hour.
 */
function minutesInto(d: Date, date: DateStr): number {
  const day = localDate(d);
  if (day < date) return 0;
  if (day > date) return 1440;
  return d.getHours() * 60 + d.getMinutes();
}
// Events are drawn at least this many minutes tall; overlap layout uses the same.
const MIN_MINUTES = 25;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Side-by-side columns for events that overlap, as in every calendar. */
function layoutDay(items: { p: Placed; top: number; bottom: number }[]) {
  const out: { p: Placed; top: number; bottom: number; col: number; cols: number }[] = [];
  let cluster: typeof out = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(0, ...cluster.map((c) => c.col)) + 1;
    for (const c of cluster) c.cols = cols;
    out.push(...cluster);
    cluster = [];
  };
  for (const it of [...items].sort((a, b) => a.top - b.top || b.bottom - a.bottom)) {
    if (it.top >= clusterEnd && cluster.length) flush();
    const ends: number[] = [];
    for (const c of cluster) ends[c.col] = Math.max(ends[c.col] ?? -1, c.bottom);
    let col = 0;
    while (ends[col] != null && ends[col]! > it.top) col++;
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.bottom);
  }
  if (cluster.length) flush();
  return out;
}

function WeekView({ from, today, placed, colours }: { from: DateStr; today: DateStr; placed: Placed[]; colours: Map<string, string> }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);

  // All-day lane: each event is one bar across the days it covers, stacked into rows.
  const allDay = placed.filter((p) => p.lane === 'allday' && days.some((d) => onDay(p, d)));
  const rows: DateStr[][] = [];
  const bars = allDay.map((p) => {
    const [s, e] = daySpan(p);
    const a = Math.max(0, daysBetween(from, s));
    const b = Math.min(6, daysBetween(from, e));
    let row = rows.findIndex((r) => r.every((x) => x < days[a]! || x > days[b]!));
    if (row === -1) row = rows.push([]) - 1;
    for (let i = a; i <= b; i++) rows[row]!.push(days[i]!);
    return { p, a, b, row, cutStart: s < from, cutEnd: e > days[6]! };
  });

  const nowTop = days.includes(today) ? (minutesInto(now, today) / 60) * HOUR : null;

  // Open at the morning, or earlier when something starts earlier this week.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let first = Math.min(8, ...placed.filter((p) => p.lane === 'timed' && days.some((d) => onDay(p, d))).map((p) => p.start.getHours()));
    // On this week, late in the day, make sure the current time is in view.
    const top = el.querySelector<HTMLElement>('.wk-top')?.offsetHeight ?? 0;
    const visible = (el.clientHeight - top) / HOUR;
    const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
    if (days.includes(today) && nowHour > first + visible - 1) first = nowHour - visible + 2;
    el.scrollTop = Math.max(0, first - 0.5) * HOUR;
    // Only when the week changes, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  return (
    <div className="wk" style={{ '--days': 7 } as React.CSSProperties}>
      {/* The day headings scroll with the hours (sticky at the top), so a scrollbar narrows both alike and the columns stay lined up. */}
      <div className="wk-scroll" ref={scroller}>
        <div className="wk-top">
          <div className="wk-head">
            <div className="wk-gutter" />
            {days.map((d) => (
              <a key={d} className={`wk-day-head ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`} href={href({ area: 'calendar', view: 'agenda', date: d })} title={`${formatLong(d)} in the agenda`}>
                <span className="wk-dow">{formatDow(d)}</span>
                <span className="wk-num num">{Number(d.slice(8))}</span>
              </a>
            ))}
          </div>
          <div className="wk-allday" style={{ gridTemplateRows: `repeat(${Math.max(1, rows.length)}, 26px)` }}>
            <div className="wk-gutter wk-allday-label" style={{ gridRow: `1 / span ${Math.max(1, rows.length)}` }}>
              All day
            </div>
            {days.map((d, i) => (
              <button key={d} className="wk-allday-slot" style={{ gridColumn: i + 2, gridRow: `1 / span ${Math.max(1, rows.length)}` }} onClick={() => openEvent({ draft: { date: d, allDay: true } })} aria-label={`New all-day event on ${formatLong(d)}`} />
            ))}
            {bars.map(({ p, a, b, row, cutStart, cutEnd }) => (
              <button
                key={`${p.ev.id}`}
                className={`ev-bar ${cutStart ? 'cut-start' : ''} ${cutEnd ? 'cut-end' : ''} ${p.end <= now ? 'past' : ''}`}
                style={{ ...eventStyle(p.ev, colours), gridColumn: `${a + 2} / ${b + 3}`, gridRow: row + 1 }}
                onClick={() => openEvent({ event: p.ev })}
                title={`${p.ev.title}, ${timeLabel(p)}`}
              >
                {p.ev.title}
              </button>
            ))}
          </div>
        </div>
        <div className="wk-body" style={{ height: 24 * HOUR }}>
          <div className="wk-gutter wk-hours" aria-hidden="true">
            {Array.from({ length: 23 }, (_, h) => {
              const top = (h + 1) * HOUR;
              // The current time's label takes over when it's close to an hour's.
              return nowTop != null && Math.abs(nowTop - top) < 16 ? null : (
                <span key={h} style={{ top }}>
                  {fmtTime(new Date(2000, 0, 1, h + 1))}
                </span>
              );
            })}
            {nowTop != null ? (
              <span className="now-label" style={{ top: nowTop }}>
                {fmtTime(now)}
              </span>
            ) : null}
          </div>
          {days.map((d) => (
            <DayColumn key={d} date={d} today={today} now={now} placed={placed} colours={colours} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayColumn({ date, today, now, placed, colours }: { date: DateStr; today: DateStr; now: Date; placed: Placed[]; colours: Map<string, string> }) {
  const [ghost, setGhost] = useState<{ a: number; b: number } | null>(null);
  const drag = useRef<{ start: number; moved: boolean } | null>(null);

  const items = layoutDay(
    placed
      .filter((p) => p.lane === 'timed' && onDay(p, date))
      .map((p) => {
        const top = minutesInto(p.start, date);
        return { p, top, bottom: Math.max(minutesInto(p.end, date), Math.min(1440, top + MIN_MINUTES)) };
      }),
  );

  const minuteAt = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const m = ((e.clientY - rect.top) / HOUR) * 60;
    return Math.min(1440 - SNAP, Math.max(0, Math.floor(m / SNAP) * SNAP));
  };

  // Press and drag on empty time to make an event that long; a click makes an hour.
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const m = minuteAt(e);
    drag.current = { start: m, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setGhost({ a: m, b: m + 60 });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const m = minuteAt(e);
    if (m !== drag.current.start) drag.current.moved = true;
    if (!drag.current.moved) return;
    const a = Math.min(drag.current.start, m);
    const b = Math.max(drag.current.start, m) + SNAP;
    setGhost({ a, b });
  };
  const up = () => {
    if (!drag.current || !ghost) return;
    drag.current = null;
    setGhost(null);
    const end = Math.min(ghost.b, 1440);
    openEvent({ draft: { date, start: hhmm(ghost.a), end: end === 1440 ? '00:00' : hhmm(end), endDate: end === 1440 ? addDays(date, 1) : date } });
  };

  const nowMin = date === today ? minutesInto(now, date) : null;
  return (
    <div
      className={`wk-col ${date === today ? 'today' : ''} ${date < today ? 'past' : ''} ${weekday(date) % 6 === 0 ? 'weekend' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        drag.current = null;
        setGhost(null);
      }}
      aria-label={formatLong(date)}
    >
      {items.map(({ p, top, bottom, col, cols }) => {
        const height = ((bottom - top) / 60) * HOUR;
        const short = height < 40;
        const fit = blockLines(height, !!p.ev.location);
        return (
          <button
            key={p.ev.id}
            className={`ev-block ${short ? 'short' : ''} ${p.end <= now ? 'past' : ''}`}
            style={{ ...eventStyle(p.ev, colours), top: (top / 60) * HOUR, height: height - 2, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, '--title-lines': fit.title } as React.CSSProperties}
            onClick={() => openEvent({ event: p.ev })}
            title={`${p.ev.title}, ${timeLabel(p)}${p.ev.location ? `, ${p.ev.location}` : ''}`}
          >
            <span className={`ev-title ${fit.title === 1 ? 'one-line' : ''}`}>{p.ev.title}</span>
            <span className="ev-time">{short ? fmtTime(p.start) : timeLabel(p)}</span>
            {!short && fit.location ? <span className="ev-loc">{p.ev.location}</span> : null}
          </button>
        );
      })}
      {ghost ? (
        <div className="ev-ghost" style={{ top: (ghost.a / 60) * HOUR, height: ((ghost.b - ghost.a) / 60) * HOUR - 2 }}>
          {fmtRange(new Date(2000, 0, 1, 0, ghost.a), new Date(2000, 0, 1, 0, ghost.b))}
        </div>
      ) : null}
      {nowMin != null ? <div className="now-line" style={{ top: (nowMin / 60) * HOUR }} aria-hidden="true" /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ month

function MonthView({ from, month, today, placed, colours }: { from: DateStr; month: string; today: DateStr; placed: Placed[]; colours: Map<string, string> }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  // Drop a last row that's entirely next month.
  const shown = days.slice(0, days[35]!.slice(0, 7) !== month ? 35 : 42);
  const now = useNow();
  return (
    <div className="mo">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
        <div key={d} className="mo-dow">
          {d}
        </div>
      ))}
      {shown.map((d) => {
        const evs = placed.filter((p) => onDay(p, d));
        const more = evs.length - 3;
        return (
          <div key={d} className={`mo-cell ${d.slice(0, 7) !== month ? 'outside' : ''} ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`}>
            <button className="mo-new" onClick={() => openEvent({ draft: { date: d } })} aria-label={`New event on ${formatLong(d)}`} />
            <a className="mo-num num" href={href({ area: 'calendar', view: 'week', date: d })} title={`Week of ${formatLong(d)}`}>
              {Number(d.slice(8))}
            </a>
            <ul className="mo-events">
              {evs.slice(0, more > 0 ? 2 : 3).map((p) => (
                <li key={p.ev.id}>
                  <button className={`mo-ev ${p.lane === 'allday' ? 'allday' : ''} ${p.end <= now ? 'past' : ''}`} style={eventStyle(p.ev, colours)} onClick={() => openEvent({ event: p.ev })} title={`${p.ev.title}, ${timeLabel(p)}`}>
                    {p.lane === 'timed' ? <span className="mo-time num">{fmtTime(p.start)}</span> : null}
                    <span className="mo-title">{p.ev.title}</span>
                  </button>
                </li>
              ))}
              {more > 0 ? (
                <li>
                  <a className="mo-more" href={href({ area: 'calendar', view: 'week', date: d })}>
                    {more + 1} more
                  </a>
                </li>
              ) : null}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ agenda

function AgendaView({ from, today, placed, colours, loaded }: { from: DateStr; today: DateStr; placed: Placed[]; colours: Map<string, string>; loaded: boolean }) {
  const days = Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(from, i));
  const now = useNow();
  const groups = days.map((d) => ({ d, evs: placed.filter((p) => onDay(p, d)) })).filter((g) => g.evs.length || g.d === today);
  if (!loaded) return <div className="agenda loading" aria-busy="true" />;
  if (!groups.length) {
    return (
      <div className="empty">
        <strong>Nothing on for the next {AGENDA_DAYS} days.</strong>
        <button className="link-btn" onClick={() => openEvent({ draft: { date: from } })}>
          Add an event
        </button>
      </div>
    );
  }
  return (
    <ol className="agenda">
      {groups.map(({ d, evs }) => (
        <li key={d} className={`ag-day ${d === today ? 'today' : ''}`}>
          <h2 className="ag-date">
            <span className="ag-num num">{Number(d.slice(8))}</span>
            <span className="ag-label">
              <span className="ag-dow">{formatWeekday(d)}</span>
              <span className="faint">{d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : formatMonth(d)}</span>
            </span>
          </h2>
          {evs.length ? (
            <ul className="ag-list">
              {evs.map((p) => (
                <AgendaRow key={p.ev.id} p={p} colours={colours} now={now} day={d} />
              ))}
            </ul>
          ) : (
            <p className="faint ag-none">Nothing on.</p>
          )}
        </li>
      ))}
    </ol>
  );
}

export function AgendaRow({ p, colours, now, day }: { p: Placed; colours: Map<string, string>; now: Date; day: DateStr }) {
  const happening = p.lane === 'timed' && p.start <= now && p.end > now;
  const multi = daySpan(p)[0] !== daySpan(p)[1];
  const when = p.lane === 'allday' ? (multi ? `Day ${daysBetween(daySpan(p)[0], day) + 1} of ${daysBetween(daySpan(p)[0], daySpan(p)[1]) + 1}` : 'All day') : localDate(p.start) !== day ? `Until ${fmtTime(p.end)}` : fmtRange(p.start, p.end);
  return (
    <li>
      <button className={`ag-ev ${p.end <= now ? 'past' : ''} ${happening ? 'now' : ''}`} style={eventStyle(p.ev, colours)} onClick={() => openEvent({ event: p.ev })}>
        <span className="ag-time num">{when}</span>
        <span className="ag-body">
          <span className="ag-title">
            {p.ev.title}
            {p.ev.recurring ? <IconRepeat className="ag-icon" title="Repeats" /> : null}
          </span>
          {p.ev.location ? (
            <span className="ag-meta">
              <IconPin className="ag-icon" /> {p.ev.location}
            </span>
          ) : null}
        </span>
        {happening ? <span className="ag-now">Now</span> : null}
      </button>
      {p.ev.meetLink && p.end > now ? (
        <a className="btn btn-sm ag-join" href={p.ev.meetLink} target="_blank" rel="noreferrer" title="Join video call">
          <IconVideo /> Join
        </a>
      ) : null}
    </li>
  );
}
