import { useProfile } from '../profile.ts';
// Today: what the user needs on opening the dashboard, in order. The week ahead
// with the next thing lit, the work in focus and in progress, what needs a
// hand, then a glance at training, weight, money and tonight's watching.
// Past logs live in their areas.

import { addDays, daysBetween, formatShort, type DateStr } from '../../shared/dates.ts';
import type { CalEvent, CalendarRange } from '../../shared/calendar/types.ts';
import type { HealthSnapshot } from '../../shared/health/types.ts';
import { COLUMN_LABELS, BOARD_LABELS } from '../../shared/work/schemas.ts';
import type { Card, Project, WorkSnapshot } from '../../shared/work/types.ts';
import type { WatchItem } from '../../shared/watch/types.ts';
import { openEvent } from '../calendar/EventSheet.tsx';
import { useCalendar } from '../calendar/store.ts';
import { colourOf, fmtTime, onDay, place, sortPlaced, type Placed } from '../calendar/time.ts';
import { openEditor } from '../health/editors.tsx';
import { useDerived, type Derived } from '../health/derive.ts';
import { kg, signed } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { moneyNotices } from '../money/derive.ts';
import { useMoney } from '../money/store.ts';
import { useNotes } from '../notes/store.ts';
import { money as fmtMoney } from '../../shared/money/tax.ts';
import type { MoneySnapshot } from '../../shared/money/types.ts';
import { IconArrowRight, IconCheck, IconChevron, IconDumbbell, IconFilm, IconFlag, IconHealth, IconInbox, IconMoney, IconNotes, IconPin, IconSend, IconStar } from '../ui/icons.tsx';
import { cardColour, ColumnIcon, stageColour } from './work/Board.tsx';
import { useWatch } from '../watch/store.ts';
import { followUpsDue } from '../work/derive.ts';
import { useWork } from '../work/store.ts';
import { useNow } from './calendar/CalendarPage.tsx';

const greeting = (h: number) => (h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
const longDay = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const weekdayName = new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' });
const weekdayShort = new Intl.DateTimeFormat('en-AU', { weekday: 'short', timeZone: 'UTC' });
const at = (d: DateStr) => new Date(`${d}T00:00:00Z`);

/** "Today", "Tomorrow", a weekday within the week, or a date. */
function dayWord(day: DateStr, today: DateStr): string {
  const n = daysBetween(today, day);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n > 1 && n < 7) return weekdayName.format(at(day));
  return formatShort(day);
}

/** "today", "tomorrow", "on Tuesday", "on 14 Nov", for the middle of a sentence. */
function dayPhrase(day: DateStr, today: DateStr): string {
  const w = dayWord(day, today);
  return w === 'Today' || w === 'Tomorrow' ? w.toLowerCase() : `on ${w}`;
}

/** Work that's under way: software Doing, and Film & TV from Developing to In Play. */
const ACTIVE = new Set(['doing', 'developing', 'writing', 'out', 'in-play']);

export function Today({ data }: { data: HealthSnapshot }) {
  const profile = useProfile().data?.profile;
  const d = useDerived(data);
  const now = useNow();
  const today = data.today;
  // Today and the six days after it: "the coming week".
  const calendar = useCalendar(today, addDays(today, 7));
  const cal = calendar.data;
  const work = useWork().data;
  const money = useMoney().data;
  const notes = useNotes().data;
  const ideas = notes?.ideas.filter((i) => i.status === 'inbox').length ?? 0;
  const watch = useWatch().data;

  // In time order: an event already under way counts from today; all-day before timed on the same day.
  const upcoming = (cal?.events ?? [])
    .map(place)
    .filter((p) => p.end > now && p.ev.source !== 'work')
    .sort((a, b) => dayOf(a, today).localeCompare(dayOf(b, today)) || (a.lane === b.lane ? a.start.getTime() - b.start.getTime() : a.lane === 'allday' ? -1 : 1));
  const dueSoon = (work?.cards ?? []).filter((c) => c.due && c.column !== 'done' && c.column !== 'shelved' && daysBetween(today, c.due) <= 7).sort((a, b) => a.due!.localeCompare(b.due!));

  return (
    <div className="page today">
      <header className="today-head">
        <div className="today-hello">
          <p className="today-date">{longDay.format(at(today))}</p>
          <h1 className="today-title">{greeting(now.getHours())}{profile?.displayName ? `, ${profile.displayName}` : ''}</h1>
          <p className="summary">{summary(cal ? upcoming : null, work ? dueSoon : [], d, data, today, now)}</p>
        </div>
        <p className="today-clock num" aria-hidden="true">
          {now.getHours() % 12 || 12}
          <span className="today-clock-colon">:</span>
          {String(now.getMinutes()).padStart(2, '0')}
          <span className="today-clock-period">{now.getHours() < 12 ? 'am' : 'pm'}</span>
        </p>
      </header>

      <Week cal={cal} error={calendar.error} today={today} now={now} />

      <div className="today-grid">
        <div className="today-main">
          <Focus work={work} today={today} />
          <InProgress work={work} today={today} />
        </div>
        <div className="today-side">
          <Attention loaded={!!(work && money && notes)} work={work} money={money} ideas={ideas} d={d} today={today} dueSoon={dueSoon} />
          <div className="glances">
            <Training data={data} d={d} />
            <Weight d={d} today={today} />
            <Money money={money} />
            <Tonight items={watch?.items ?? []} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One or two sentences: the next thing in time, the nearest deadline, the
 * gym. `upcoming` is null until the calendar has loaded, and then says nothing.
 */
function summary(upcoming: Placed[] | null, dueSoon: Card[], d: Derived, data: HealthSnapshot, today: DateStr, now: Date): string {
  const out: string[] = [];
  if (upcoming) {
    const timed = upcoming.filter((p) => p.lane === 'timed');
    const next = timed[0];
    const allDayToday = upcoming.filter((p) => p.lane === 'allday' && onDay(p, today));
    if (next && next.start <= now) out.push(`${next.ev.title} is on until ${fmtTime(next.end)}.`);
    else if (next && onDay(next, today)) out.push(`${next.ev.title} at ${fmtTime(next.start)}.`);
    else if (allDayToday.length) out.push(`Today: ${allDayToday.map((p) => p.ev.title).join(', ')}.`);
    else if (upcoming.length) {
      const first = next ?? upcoming[0]!;
      out.push(`Nothing on today. Next up: ${first.ev.title} ${dayPhrase(dayOf(first, today), today)}${first.lane === 'timed' ? ` at ${fmtTime(first.start)}` : ''}.`);
    } else out.push('Nothing on your calendar for the coming week.');
  }
  const due = dueSoon[0];
  if (due) {
    const late = -daysBetween(today, due.due!);
    out.push(late > 0 ? `${due.title} is ${late} day${late === 1 ? '' : 's'} late.` : `${due.title} is due ${dayPhrase(due.due!, today)}.`);
  }
  if (data.workouts.some((w) => w.date === today)) out.push('You trained today.');
  else if (d.cycle.next) out.push(`Day ${d.cycle.next.position} is next at the gym.`);
  return out.join(' ');
}

const localDay = (d: Date): DateStr => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The day an event belongs to from here: its start, or today if it's already under way. */
const dayOf = (p: Placed, today: DateStr): DateStr => {
  const d = localDay(p.start);
  return d < today ? today : d;
};

// ------------------------------------------------------------------ the week

/**
 * The seven days from today, side by side. Each day lists its deadlines and
 * events; the next thing in time is lit in its calendar's colour, the one
 * bright thing on the page. Events already over today stay, dimmed.
 */
function Week({ cal, error, today, now }: { cal: CalendarRange | null; error: string | null; today: DateStr; now: Date }) {
  const colours = new Map((cal?.status.calendars ?? []).map((c) => [c.id, c.color]));
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const placed = (cal?.events ?? []).map(place).sort(sortPlaced);
  // The next event: the first timed one not yet over, or failing that the first all-day one ahead.
  const ahead = placed.filter((p) => p.ev.source !== 'work' && p.end > now).sort((a, b) => a.start.getTime() - b.start.getTime());
  const next = ahead.find((p) => p.lane === 'timed') ?? ahead[0];
  const open = (ev: CalEvent) => openEvent({ event: ev });
  return (
    <section className="week" aria-label="The week ahead" aria-busy={!cal && !error}>
      <ol className="week-days">
        {days.map((day) => {
          const items = placed.filter((p) => onDay(p, day));
          const shown = items.slice(0, 5);
          return (
            <li key={day} className={`week-day ${day === today ? 'is-today' : ''} ${weekday(day) >= 5 ? 'is-weekend' : ''}`}>
              <a className="week-head" href={href({ area: 'calendar', view: 'week', date: day })} title="Open in Calendar">
                <span className="week-name">{day === today ? 'Today' : weekdayShort.format(at(day))}</span>
                <span className="week-date num">{Number(day.slice(8))}</span>
              </a>
              <ul className="week-items">
                {shown.map((p) =>
                  p === next ? (
                    <li key={p.ev.id}>
                      <button className="week-next" style={{ '--ev': colourOf(p.ev, colours) } as React.CSSProperties} onClick={() => open(p.ev)}>
                        <span className="week-next-when">{relative(p, now)}</span>
                        {p.lane === 'timed' ? <span className="week-next-time num">{fmtTime(p.start)}</span> : null}
                        <span className="week-next-title">{p.ev.title}</span>
                        {p.ev.location ? (
                          <span className="week-next-where">
                            <IconPin /> {p.ev.location}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ) : (
                    <li key={p.ev.id}>
                      <button
                        className={`week-ev ${p.ev.source === 'work' ? 'is-due' : ''} ${p.end <= now ? 'is-past' : ''}`}
                        style={{ '--ev': colourOf(p.ev, colours) } as React.CSSProperties}
                        onClick={() => open(p.ev)}
                      >
                        {p.ev.source === 'work' ? <IconFlag className="week-flag" /> : null}
                        <span className="week-ev-title">{p.ev.source === 'work' ? p.ev.title.replace(/^Due:\s*/, '') : p.ev.title}</span>
                        <span className="week-ev-time num">{p.ev.source === 'work' ? 'Due' : p.lane === 'timed' ? fmtTime(p.start) : 'All day'}</span>
                      </button>
                    </li>
                  ),
                )}
                {items.length > shown.length ? (
                  <li>
                    <a className="week-more" href={href({ area: 'calendar', view: 'week', date: day })}>
                      {items.length - shown.length} more
                    </a>
                  </li>
                ) : null}
              </ul>
            </li>
          );
        })}
      </ol>
      {error && !cal ? (
        <p className="week-note">The calendar couldn't load: {error}</p>
      ) : cal && !cal.status.connected ? (
        <p className="week-note">
          Google Calendar isn't connected, so only events added here show.{' '}
          <a className="link-btn" href={href({ area: 'calendar', view: 'week' })}>
            Connect it
          </a>
        </p>
      ) : null}
    </section>
  );
}

/** "Now", "In 20 min", "In 3 h", or just "Up next": how far off the next thing is. */
function relative(p: Placed, now: Date): string {
  if (p.start <= now) return p.lane === 'timed' ? `Now, until ${fmtTime(p.end)}` : 'Today';
  const mins = Math.round((p.start.getTime() - now.getTime()) / 60_000);
  if (p.lane === 'timed' && mins < 60) return mins < 1 ? 'Starting now' : `In ${mins} min`;
  if (p.lane === 'timed' && mins < 12 * 60 && onDay(p, localDay(now))) return `In ${Math.round(mins / 60)} h`;
  return 'Up next';
}

/** Monday is 0, Sunday 6. */
const weekday = (d: DateStr) => (at(d).getUTCDay() + 6) % 7;

// ------------------------------------------------------------------ work

const projectOf = (c: Card, projects: Map<number, Project>) => (c.projectId ? projects.get(c.projectId) : undefined);

function Due({ due, today }: { due: DateStr; today: DateStr }) {
  const n = daysBetween(today, due);
  const tint = n < 0 ? 'var(--red)' : n <= 2 ? 'var(--orange)' : 'var(--gray)';
  return (
    <span className="badge" style={{ '--tint': tint } as React.CSSProperties}>
      {n < 0 ? `${-n}d late` : dayWord(due, today)}
    </span>
  );
}

function Focus({ work, today }: { work: WorkSnapshot | null; today: DateStr }) {
  const cards = (work?.cards ?? []).filter((c) => c.focus);
  const projects = new Map((work?.projects ?? []).map((p) => [p.id, p]));
  return (
    <section className="focus-panel" aria-labelledby="focus-title">
      <div className="today-sec-head">
        <h2 id="focus-title">Focus</h2>
        <a className="link-btn" href={href({ area: 'work', tab: 'review' })}>
          {cards.length ? 'Change' : 'Choose'}
        </a>
      </div>
      {!work ? null : cards.length ? (
        <ol className="focus-list">
          {cards.map((c, i) => {
            const p = projectOf(c, projects);
            return (
              <li key={c.id}>
                <a className="focus-row" href={href({ area: 'work', tab: c.board, card: c.id })} style={{ '--proj': cardColour(c, p) ?? stageColour(c.column), '--stage': stageColour(c.column) } as React.CSSProperties}>
                  <span className="focus-num num">{i + 1}</span>
                  <span className="focus-body">
                    <span className="focus-name">{c.title}</span>
                    <span className="focus-meta">
                      <span className="focus-stage">
                        <ColumnIcon column={c.column} />
                        {COLUMN_LABELS[c.column]}
                      </span>
                      <span className="focus-proj">
                        <span className="dot" />
                        {p ? p.name : BOARD_LABELS[c.board]}
                      </span>
                    </span>
                    {c.nextAction ? (
                      <span className="focus-next">
                        <IconArrowRight /> {c.nextAction}
                      </span>
                    ) : null}
                  </span>
                  {c.due ? <Due due={c.due} today={today} /> : null}
                </a>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="focus-empty">
          <IconStar />
          <p>Pick up to three cards to keep in front of you.</p>
        </div>
      )}
    </section>
  );
}

function InProgress({ work, today }: { work: WorkSnapshot | null; today: DateStr }) {
  const projects = new Map((work?.projects ?? []).map((p) => [p.id, p]));
  const cards = (work?.cards ?? [])
    .filter((c) => ACTIVE.has(c.column) && !c.focus)
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.board.localeCompare(b.board) || a.position - b.position);
  return (
    <section className="progress" aria-labelledby="progress-title">
      <div className="today-sec-head">
        <h2 id="progress-title">In progress</h2>
        <a className="link-btn" href={href({ area: 'work', tab: cards[0]?.board ?? 'software' })}>
          Boards
        </a>
      </div>
      {!work ? null : cards.length ? (
        <ul className="progress-list">
          {cards.slice(0, 7).map((c) => {
            const p = projectOf(c, projects);
            return (
              <li key={c.id}>
                <a className="progress-row" href={href({ area: 'work', tab: c.board, card: c.id })} style={{ '--proj': cardColour(c, p) ?? stageColour(c.column), '--stage': stageColour(c.column) } as React.CSSProperties}>
                  <span className="progress-status" title={COLUMN_LABELS[c.column]}>
                    <ColumnIcon column={c.column} />
                  </span>
                  <span className="progress-title">{c.title}</span>
                  <span className="progress-proj">
                    <span className="dot" />
                    {p ? p.name : BOARD_LABELS[c.board]}
                  </span>
                  <span className="progress-due">{c.due ? <Due due={c.due} today={today} /> : null}</span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="today-none">Nothing else under way. Cards in Doing, or Developing to In Play, show here.</p>
      )}
      {cards.length > 7 ? <p className="today-more">{cards.length - 7} more on the boards</p> : null}
    </section>
  );
}

// ------------------------------------------------------------------ needs attention

type Item = { key: string; tint: string; icon: React.ReactNode; title: string; sub?: string; href?: string; onClick?: () => void };

/** "Yesterday's", "Friday's", or "6 Nov's" for anything a week or more back. */
function foodDay(day: DateStr, today: DateStr): string {
  const n = daysBetween(day, today);
  return n === 1 ? "Yesterday's" : n < 7 ? `${weekdayName.format(at(day))}'s` : `${formatShort(day)}'s`;
}

function Attention({ loaded, work, money, ideas, d, today, dueSoon }: { loaded: boolean; work: WorkSnapshot | null; money: Parameters<typeof moneyNotices>[0]; ideas: number; d: Derived; today: DateStr; dueSoon: Card[] }) {
  const items: Item[] = [];
  for (const c of dueSoon.filter((c) => !c.focus && daysBetween(today, c.due!) <= 3)) {
    const n = daysBetween(today, c.due!);
    items.push({ key: `due${c.id}`, tint: 'var(--red)', icon: <IconFlag />, title: c.title, sub: n < 0 ? `Was due ${formatShort(c.due!)}` : `Due ${dayPhrase(c.due!, today)}`, href: href({ area: 'work', tab: c.board, card: c.id }) });
  }
  for (const n of moneyNotices(money)) {
    items.push({ key: n.key, tint: n.kind === 'money' ? 'var(--green)' : 'var(--orange)', icon: n.kind === 'money' ? <IconMoney /> : <IconNotes />, title: n.text, href: n.href });
  }
  if (work) {
    for (const { submission: s, card } of followUpsDue(work)) {
      items.push({ key: `sub${s.id}`, tint: 'var(--blue)', icon: <IconSend />, title: `Follow up with ${s.recipient}`, sub: `${card.title}, sent ${daysBetween(s.sentOn, today)} days ago`, href: href({ area: 'work', tab: 'film', card: card.id }) });
    }
  }
  if (ideas) items.push({ key: 'ideas', tint: '#e6a700', icon: <IconInbox />, title: `${ideas} idea${ideas === 1 ? '' : 's'} to sort`, href: href({ area: 'notes', tab: 'ideas' }) });
  const missing = d.catchUp.missingNutrition;
  if (missing.length) {
    const last = missing.at(-1)!;
    items.push({ key: 'food', tint: 'var(--pink)', icon: <IconHealth />, title: missing.length === 1 ? `${foodDay(last, today)} food isn't logged` : `${missing.length} days of food aren't logged`, sub: 'Send Claude the Macrau recap', onClick: () => openEditor({ kind: 'day', date: last }) });
  }
  return (
    <section className="attention" aria-labelledby="attention-title">
      <div className="today-sec-head">
        <h2 id="attention-title">Needs attention</h2>
      </div>
      {!loaded && !items.length ? null : items.length ? (
        <ul className="list" style={{ '--inset': '58px' } as React.CSSProperties}>
          {items.map((i) => {
            const body = (
              <>
                <span className="list-icon" style={{ '--tint': i.tint } as React.CSSProperties}>
                  {i.icon}
                </span>
                <span className="list-main">
                  <span className="list-title">{i.title}</span>
                  {i.sub ? <span className="list-sub">{i.sub}</span> : null}
                </span>
                <IconChevron />
              </>
            );
            return (
              <li key={i.key}>
                {i.href ? (
                  <a className="list-row" href={i.href}>
                    {body}
                  </a>
                ) : (
                  <button className="list-row list-btn" onClick={i.onClick}>
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="all-clear">
          <span className="list-icon" style={{ '--tint': 'var(--green)' } as React.CSSProperties}>
            <IconCheck />
          </span>
          <span>All clear. Nothing overdue, nothing waiting on you.</span>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ glances

function Ring({ value, of, tint }: { value: number; of: number; tint: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const f = of ? Math.min(1, value / of) : 0;
  return (
    <svg className="glance-ring" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="ring-lit" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r={r} fill="none" stroke={tint} strokeOpacity="0.18" strokeWidth="7" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={tint} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 32 32)" />
      <circle cx="32" cy="32" r={r} fill="none" stroke="url(#ring-lit)" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 32 32)" />
    </svg>
  );
}

function Training({ data, d }: { data: HealthSnapshot; d: Derived }) {
  const next = d.cycle.next;
  const total = data.program.length;
  const done = d.cycle.done.size + d.cycle.skipped.size;
  const trained = data.workouts.some((w) => w.date === data.today);
  return (
    <section className="glance" style={{ '--tint': 'var(--training)' } as React.CSSProperties}>
      <p className="glance-label">
        <IconDumbbell /> Training
      </p>
      <div className="glance-row">
        <div>
          <p className="glance-big">{trained ? 'Done today' : next ? `Day ${next.position}` : 'No program'}</p>
          <p className="glance-sub">{next ? (trained ? `Next: ${next.name}` : next.name) : 'Set up a program in Health'}</p>
        </div>
        {total ? <Ring value={done} of={total} tint="var(--training)" /> : null}
      </div>
      <p className="glance-foot">
        {total ? `${done} of ${total} days this cycle` : ''}
        {next && !trained ? (
          <button className="link-btn" onClick={() => openEditor({ kind: 'workout', programDayId: next.id })}>
            Log workout
          </button>
        ) : null}
      </p>
    </section>
  );
}

function Weight({ d, today }: { d: Derived; today: DateStr }) {
  const w = d.latestWeight;
  const t = d.latestTrend;
  const series = d.trend.filter((p) => daysBetween(p.date, today) <= 365);
  const change = d.change.d90 ?? d.change.d30;
  let path = '';
  if (series.length > 1) {
    const ks = series.map((p) => p.trend);
    const lo = Math.min(...ks) - 0.3;
    const hi = Math.max(...ks) + 0.3;
    const t0 = at(series[0]!.date).getTime();
    const span = at(series.at(-1)!.date).getTime() - t0 || 1;
    path = series.map((p, i) => `${i ? 'L' : 'M'}${(((at(p.date).getTime() - t0) / span) * 200).toFixed(1)} ${(48 - ((p.trend - lo) / (hi - lo)) * 44).toFixed(1)}`).join(' ');
  }
  return (
    <a className="glance" href="#/health/body" style={{ '--tint': 'var(--weight)' } as React.CSSProperties}>
      <p className="glance-label">
        <IconHealth /> Weight
      </p>
      <div className="glance-row">
        <div>
          <p className="glance-big num">
            {w ? (
              <>
                {kg(w.kg)}
                <span className="glance-unit">kg</span>
              </>
            ) : (
              '–'
            )}
          </p>
          <p className="glance-sub">{t ? `Trend ${kg(t.trend)} kg` : 'No weigh-ins yet'}</p>
        </div>
        {path ? (
          <svg className="spark" viewBox="0 0 200 52" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--weight)" stopOpacity="0.35" />
                <stop offset="1" stopColor="var(--weight)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${path} L200 52 L0 52 Z`} fill="url(#spark-fill)" />
            <path d={path} fill="none" stroke="var(--weight)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
      </div>
      <p className="glance-foot">{change ? `${signed(change.kg)} kg since ${formatShort(change.since)}` : w ? `Weighed ${formatShort(w.date)}` : ''}</p>
    </a>
  );
}

/** What's owed: the total unpaid, and how much of it is past due. */
function Money({ money }: { money: MoneySnapshot | null }) {
  const unpaid = (money?.income ?? []).filter((i) => !i.paidDate);
  const late = unpaid.filter((i) => i.dueDate && i.dueDate < money!.today);
  const sum = (cur: string) => unpaid.filter((i) => i.currency === cur).reduce((t, i) => t + i.amount, 0);
  const aud = sum('AUD');
  const usd = sum('USD');
  const whole = (cents: number, cur?: string) => fmtMoney(cents, cur).replace(/\.00$/, '');
  return (
    <a className="glance" href={href({ area: 'money', tab: 'income' })} style={{ '--tint': 'var(--green)' } as React.CSSProperties}>
      <p className="glance-label">
        <IconMoney /> Owed to you
      </p>
      <p className="glance-big num">{!money ? '–' : aud || !usd ? whole(aud) : whole(usd, 'USD')}</p>
      <p className="glance-sub">{usd && aud ? `and ${whole(usd, 'USD')}` : unpaid.length ? `${unpaid.length} invoice${unpaid.length === 1 ? '' : 's'} out` : 'Nothing outstanding'}</p>
      <p className="glance-foot">{late.length ? <span className="glance-warn">{late.length} overdue</span> : unpaid.length ? 'None overdue' : ''}</p>
    </a>
  );
}

function Tonight({ items }: { items: WatchItem[] }) {
  const pick = items.find((i) => i.status === 'watching') ?? items.filter((i) => i.status === 'to-watch').sort((a, b) => b.addedAt.localeCompare(a.addedAt))[0];
  return (
    <a className="glance glance-watch" href={pick ? href({ area: 'watch', status: pick.status, id: pick.id }) : href({ area: 'watch', status: 'to-watch' })} style={{ '--tint': 'var(--purple)' } as React.CSSProperties}>
      {pick?.poster ? <img className="glance-backdrop" src={pick.poster} alt="" aria-hidden="true" /> : null}
      {pick?.poster ? <img className="glance-poster" src={pick.poster} alt="" /> : null}
      <div className="glance-watch-body">
        <p className="glance-label">
          <IconFilm /> {pick?.status === 'watching' ? 'Watching' : 'Up next to watch'}
        </p>
        <p className="glance-title">{pick ? pick.title : 'Nothing on the list'}</p>
        <p className="glance-sub">{pick ? [pick.year, pick.providers?.flatrate[0] ? `on ${pick.providers.flatrate[0]}` : null].filter(Boolean).join(', ') : 'Add something to watch'}</p>
      </div>
    </a>
  );
}
