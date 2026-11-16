import { addDays, formatLong, formatMonthYear, weekStart, type DateStr } from '../../../shared/dates.ts';
import { belowTarget, proteinHit } from '../../../shared/health/metrics.ts';
import type { HealthSnapshot } from '../../../shared/health/types.ts';
import type { Derived } from '../../health/derive.ts';
import { openEditor } from '../../health/editors.tsx';
import { kg, plural } from '../../lib/format.ts';
import { href } from '../../lib/router.ts';
import { IconCamera, IconChevronLeft, IconChevronRight, IconDumbbell } from '../../ui/icons.tsx';

const monthOf = (d: DateStr) => d.slice(0, 7);
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const t = new Date(Date.UTC(y, mo - 1 + by, 1));
  return t.toISOString().slice(0, 7);
};

export function LogView({ data, d, month: param }: { data: HealthSnapshot; d: Derived; month?: string }) {
  const month = param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : monthOf(data.today);
  const first = `${month}-01`;
  const start = weekStart(first);
  const nextMonthFirst = `${shiftMonth(month, 1)}-01`;
  const cells: DateStr[] = [];
  for (let day = start; day < nextMonthFirst || cells.length % 7 !== 0; day = addDays(day, 1)) cells.push(day);

  const inMonth = (x: DateStr) => monthOf(x) === month;
  const workoutsByDate = new Map<DateStr, HealthSnapshot['workouts']>();
  for (const w of data.workouts) workoutsByDate.set(w.date, [...(workoutsByDate.get(w.date) ?? []), w]);
  const monthDays = cells.filter(inMonth);
  const counts = {
    workouts: monthDays.reduce((n, x) => n + (workoutsByDate.get(x)?.length ?? 0), 0),
    food: monthDays.filter((x) => d.nutritionByDate.has(x)).length,
    weighIns: monthDays.filter((x) => d.weightByDate.has(x)).length,
  };

  return (
    <>
      <div className="cal-head">
        <h2 className="cal-title">{formatMonthYear(first)}</h2>
        <div className="cal-nav">
          <a className="btn btn-quiet icon-btn" href={href({ area: 'health', tab: 'log', param: shiftMonth(month, -1) })} aria-label="Previous month">
            <IconChevronLeft />
          </a>
          <a className="btn btn-sm" href={href({ area: 'health', tab: 'log' })}>
            This month
          </a>
          <a className="btn btn-quiet icon-btn" href={href({ area: 'health', tab: 'log', param: shiftMonth(month, 1) })} aria-label="Next month">
            <IconChevronRight />
          </a>
        </div>
        <p className="muted cal-summary">
          {plural(counts.workouts, 'workout')}, {plural(counts.food, 'day')} of food logged, {plural(counts.weighIns, 'weigh-in')}
        </p>
      </div>
      <div className="legend cal-legend">
        <span className="legend-item">
          <IconDumbbell className="legend-icon training" /> Trained
        </span>
        <span className="legend-item">
          <span className="dot" style={{ background: 'var(--calories)' }} /> Calories under target
        </span>
        <span className="legend-item">
          <span className="dot" style={{ background: 'var(--over)' }} /> Over target
        </span>
        <span className="legend-item">
          <span className="ring" /> Protein hit
        </span>
        <span className="legend-item">
          <IconCamera className="legend-icon" /> Photo
        </span>
      </div>
      <div className="cal-grid" role="grid" aria-label={formatMonthYear(first)}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => (
          <div key={x} className="cal-dow" role="columnheader">
            {x}
          </div>
        ))}
        {cells.map((day) => {
          const n = d.nutritionByDate.get(day);
          const w = d.weightByDate.get(day);
          const ws = workoutsByDate.get(day) ?? [];
          const below = n ? belowTarget(n) : null;
          const hit = n ? proteinHit(n) : null;
          const isToday = day === data.today;
          const future = day > data.today;
          return (
            <div
              key={day}
              role="gridcell"
              className={`cal-cell ${inMonth(day) ? '' : 'outside'} ${isToday ? 'is-today' : ''} ${future ? 'future' : ''} ${n ? (below != null && below < 0 ? 'fed-over' : 'fed-under') : ''} ${hit ? 'protein-hit' : ''} ${ws.length ? 'trained' : ''}`}
            >
              <button className="cal-day" onClick={() => openEditor({ kind: 'day', date: day })} disabled={future} aria-label={`${formatLong(day)}${n ? ', food logged' : ''}${w ? `, weighed ${kg(w.kg)} kg` : ''}${ws.length ? ', trained' : ''}`}>
                <span className="cal-num num">{Number(day.slice(8))}</span>
                <span className="cal-marks">
                  {n ? (
                    <span
                      className={`cal-food ${hit ? 'hit' : ''}`}
                      style={{ background: below != null && below < 0 ? 'var(--over)' : 'var(--calories)' }}
                      title={below != null ? (below >= 0 ? 'Under target' : 'Over target') : 'Food logged'}
                    />
                  ) : null}
                  {d.photoDates.has(day) ? <IconCamera className="cal-icon" title="Progress photo" /> : null}
                </span>
                {w ? <span className="cal-weight num">{kg(w.kg)}</span> : null}
              </button>
              {ws.map((wk) => (
                <button key={wk.id} className="cal-workout" onClick={() => openEditor({ kind: 'workout', id: wk.id })} title={wk.programDayName ?? 'Workout'}>
                  <IconDumbbell />
                  <span>{wk.programDayName ?? 'Workout'}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
