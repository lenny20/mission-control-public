import { useId, useState } from 'react';
import { addDays, formatDayMonthYear, formatMonthYear, formatShort, relativeDay, type DateStr } from '../../../shared/dates.ts';
import { belowTarget, proteinHit } from '../../../shared/health/metrics.ts';
import type { HealthSnapshot, NutritionDay } from '../../../shared/health/types.ts';
import { CaloriesChart } from '../../charts/CaloriesChart.tsx';
import { MacroBars } from '../../charts/MacroBars.tsx';
import { LiftChart, sessionPoints } from '../../charts/LiftChart.tsx';
import { ProteinDays } from '../../charts/ProteinDays.tsx';
import { WeightChart } from '../../charts/WeightChart.tsx';
import { lastDays, type Derived } from '../../health/derive.ts';
import { openEditor } from '../../health/editors.tsx';
import { kcal, kg, load, oneRm, plural, signed } from '../../lib/format.ts';
import { href } from '../../lib/router.ts';
import { Segmented } from '../../ui/fields.tsx';
import { IconCamera, IconDumbbell } from '../../ui/icons.tsx';

export type Range = '3m' | '1y' | 'all';
export const RANGES: { value: Range; label: string }[] = [
  { value: '3m', label: '3 months' },
  { value: '1y', label: '1 year' },
  { value: 'all', label: 'All' },
];
export const rangeStart = (r: Range, today: DateStr) => (r === '3m' ? addDays(today, -91) : r === '1y' ? addDays(today, -365) : null);

export function WeightSection({ data, d, initial = 'all', height = 320 }: { data: HealthSnapshot; d: Derived; initial?: Range; height?: number }) {
  const [range, setRange] = useState<Range>(initial);
  const from = rangeStart(range, data.today);
  const inRange = d.trend.filter((p) => !from || p.date >= from);
  const first = inRange[0];
  const last = inRange.at(-1);
  return (
    <section className="hero-chart" aria-labelledby="weight-title">
      <div className="hero-head">
        <div>
          <h2 id="weight-title" className="hero-label">
            Weight
          </h2>
          {last ? (
            <p className="hero-value">
              <span className="hero-num num">{kg(last.trend)}</span>
              <span className="hero-unit">kg trend</span>
            </p>
          ) : null}
          {first && last && first !== last ? (
            <p className="hero-sub">
              <span className="delta num">{signed(last.trend - first.trend)} kg</span>
              <span className="muted"> since {range === 'all' ? formatMonthYear(first.date) : formatDayMonthYear(first.date)}, across {plural(inRange.length, 'weigh-in')}</span>
            </p>
          ) : null}
        </div>
        <div className="hero-controls">
          <span className="legend">
            <span className="legend-item">
              <span className="dot" style={{ background: 'var(--weight)', opacity: 0.5 }} /> Weigh-in
            </span>
            <span className="legend-item">
              <span className="key-line" style={{ background: 'var(--weight)' }} /> Trend
            </span>
          </span>
          <Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />
        </div>
      </div>
      <WeightChart points={d.trend} from={from} to={data.today} height={height} onPick={(date) => openEditor({ kind: 'day', date })} />
    </section>
  );
}

/** Calories eaten against the day's target (exercise added back), as a ring in Macrau's colours. */
function CalorieRing({ day }: { day: NutritionDay }) {
  const target = day.targetKcal != null ? day.targetKcal + day.burnedKcal : null;
  const ratio = target ? day.eatenKcal / target : 0;
  const over = ratio > 1;
  const id = useId();
  const r = 62;
  const c = 2 * Math.PI * r;
  const f = Math.min(1, ratio);
  const colour = over ? 'var(--over)' : 'var(--calories)';
  // Where the arc ends, for its lit cap.
  const a = (f * 360 - 90) * (Math.PI / 180);
  const end = { x: 80 + r * Math.cos(a), y: 80 + r * Math.sin(a) };
  const arc = { cx: 80, cy: 80, r, fill: 'none', strokeWidth: 13, strokeLinecap: 'round' as const, strokeDasharray: `${c * f} ${c}`, transform: 'rotate(-90 80 80)' };
  return (
    <div className="cal-ring">
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}arc`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={colour} stopOpacity={0.65} />
            <stop offset="100%" stopColor={colour} />
          </linearGradient>
          <filter id={`${id}glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--calories-track)" strokeWidth="13" />
        {f > 0 ? (
          <>
            <circle {...arc} stroke={colour} strokeOpacity={0.5} filter={`url(#${id}glow)`} />
            <circle {...arc} stroke={`url(#${id}arc)`} />
            <circle cx={end.x} cy={end.y} r={3.2} fill="#fff" opacity={0.9} />
          </>
        ) : null}
      </svg>
      <span className="cal-ring-text">
        <strong className="num display">{kcal(day.eatenKcal)}</strong>
        <span>{target != null ? `of ${kcal(target)}` : 'eaten'}</span>
      </span>
    </div>
  );
}

/** The latest logged day, as Macrau's recap shows it: the calorie ring and the three macros. */
function LatestDay({ data, d }: { data: HealthSnapshot; d: Derived }) {
  const day = d.latestNutrition;
  const week = lastDays(data.today, 7);
  const weekLogged = week.map((x) => d.nutritionByDate.get(x)).filter((n) => !!n);
  const avgEaten = weekLogged.length ? weekLogged.reduce((s, n) => s + n.eatenKcal, 0) / weekLogged.length : null;
  const logged28 = lastDays(data.today, 28)
    .map((x) => d.nutritionByDate.get(x))
    .filter((n) => !!n);
  const hits = logged28.filter((n) => proteinHit(n)).length;
  if (!day) {
    return (
      <button className="health-day empty-btn" onClick={() => openEditor({ kind: 'day' })}>
        <strong>No food logged yet.</strong>
        Send Claude a Macrau recap, or click here to add a day.
      </button>
    );
  }
  const below = belowTarget(day);
  const when = relativeDay(day.date, data.today);
  return (
    <section className="health-day" aria-labelledby="day-title">
      <div className="health-panel-head">
        <h2 id="day-title">
          <span>
            {when[0]!.toUpperCase() + when.slice(1)}
            {when.endsWith('days ago') ? <span className="faint">, {formatShort(day.date)}</span> : null}
          </span>
        </h2>
        <button className="link-btn" onClick={() => openEditor({ kind: 'day', date: day.date })}>
          Open day
        </button>
      </div>
      <div className="health-day-body">
        <CalorieRing day={day} />
        <div className="health-day-macros">
          {below != null ? (
            <p className={`health-day-below ${below < 0 ? 'is-over' : ''}`}>
              <strong className="num">{kcal(Math.abs(below))}</strong> {below >= 0 ? 'below target' : 'over target'}
            </p>
          ) : null}
          <MacroBars day={day} showCalories={false} />
        </div>
      </div>
      <dl className="health-facts">
        <div>
          <dt>Last 7 days</dt>
          <dd>
            <span className="num">{avgEaten != null ? kcal(avgEaten) : '–'}</span> avg, {weekLogged.length} of 7 logged
          </dd>
        </div>
        <div>
          <dt>Protein, 4 weeks</dt>
          <dd>
            <span className="num">{hits}</span> of {logged28.length} logged days on target
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** The next program day, the cycle so far, and the week's training. */
function NextUp({ data, d }: { data: HealthSnapshot; d: Derived }) {
  const next = d.cycle.next;
  const program = [...data.program].sort((a, b) => a.position - b.position);
  const week = lastDays(data.today, 7);
  const workouts7 = data.workouts.filter((w) => w.date >= week[0]!).length;
  const last = [...data.workouts].sort((a, b) => b.date.localeCompare(a.date))[0];
  return (
    <section className="health-next" aria-labelledby="next-up-title">
      <div className="health-panel-head">
        <h2 id="next-up-title">
          <IconDumbbell /> Training
        </h2>
        <a className="link-btn" href="#/health/training">
          Program
        </a>
      </div>
      {next ? (
        <>
          <p className="health-next-day">
            Day {next.position} <span className="faint">of {program.length}</span>
          </p>
          <p className="health-next-name">{next.name}</p>
          <ol className="cycle" aria-label={`Cycle ${d.cycle.cycle}`}>
            {program.map((p) => {
              const state = d.cycle.done.has(p.id) ? 'done' : d.cycle.skipped.has(p.id) ? 'skipped' : p.id === next.id ? 'next' : 'todo';
              return (
                <li key={p.id} className={`cycle-step ${state}`} title={`Day ${p.position}: ${p.name}`}>
                  <span className="visually-hidden">
                    Day {p.position} {state}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="health-next-list faint">{next.exercises.map((e) => d.exById.get(e.exerciseId)?.name).filter(Boolean).join(', ')}</p>
          <button className="btn btn-primary health-next-log" onClick={() => openEditor({ kind: 'workout', programDayId: next.id })}>
            Log this workout
          </button>
        </>
      ) : (
        <p className="faint">No program yet. Set one up under Training.</p>
      )}
      <dl className="health-facts">
        <div>
          <dt>Last 7 days</dt>
          <dd>
            <span className="num">{workouts7}</span> {workouts7 === 1 ? 'workout' : 'workouts'}
          </dd>
        </div>
        <div>
          <dt>Last trained</dt>
          <dd>{last ? relativeDay(last.date, data.today) : 'Not yet'}</dd>
        </div>
      </dl>
    </section>
  );
}

export function Overview({ data, d }: { data: HealthSnapshot; d: Derived }) {
  const days28 = lastDays(data.today, 28);
  const lifts = d.lifts.filter((l) => d.sessions.has(l.id));
  const photos = [...data.photos].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  return (
    <>
      <div className="health-top">
        <LatestDay data={data} d={d} />
        <NextUp data={data} d={d} />
      </div>

      <WeightSection data={data} d={d} />

      <div className="two-up section">
        <section aria-labelledby="cal-title">
          <div className="section-head">
            <h2 id="cal-title">Calories, last 4 weeks</h2>
            <span className="legend">
              <span className="legend-item">
                <span className="dot" style={{ background: 'var(--calories)' }} /> Under target
              </span>
              <span className="legend-item">
                <span className="dot" style={{ background: 'var(--over)' }} /> Over
              </span>
              <span className="legend-item">
                <span className="key-line" style={{ background: 'var(--text)' }} /> Target
              </span>
            </span>
          </div>
          <CaloriesChart days={days28} byDate={d.nutritionByDate} height={256} onPick={(date) => openEditor({ kind: 'day', date })} />
        </section>
        <section aria-labelledby="protein-title">
          <div className="section-head">
            <h2 id="protein-title">Protein days</h2>
            <span className="legend">
              <span className="legend-item">
                <span className="swatch hit" /> Hit
              </span>
              <span className="legend-item">
                <span className="swatch miss" /> Short
              </span>
              <span className="legend-item">
                <span className="swatch none" /> Not logged
              </span>
            </span>
          </div>
          <ProteinDays days={days28} byDate={d.nutritionByDate} onPick={(date) => openEditor({ kind: 'day', date })} />
        </section>
      </div>

      <section className="section" aria-labelledby="strength-title">
        <div className="section-head">
          <h2 id="strength-title">Strength</h2>
          <p>Estimated one-rep max per lift. Hollow dots are personal records.</p>
        </div>
        {lifts.length ? (
          <div className="lift-grid">
            {lifts.slice(0, 8).map((ex) => {
              const sessions = d.sessions.get(ex.id)!;
              const { points, metric } = sessionPoints(sessions);
              const first = points[0]!;
              const last = points.at(-1)!;
              return (
                <a key={ex.id} className="lift-card" href={href({ area: 'health', tab: 'training', param: ex.id })}>
                  <span className="lift-name">{ex.name}</span>
                  <span className="lift-value num">
                    {metric === 'e1rm' ? oneRm(last.value) : load(last.value)} <span className="faint">{metric === 'e1rm' ? 'kg' : 'reps'}</span>
                  </span>
                  <span className="lift-delta faint num">{points.length > 1 ? `${signed(last.value - first.value, metric === 'e1rm' ? oneRm : load)} since ${formatShort(first.date)}` : 'One session so far'}</span>
                  <LiftChart sessions={sessions} height={64} compact />
                </a>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <strong>No workouts logged yet.</strong>
            After your next session, send Claude a screenshot from your gym app. Each lift gets its own progress chart here.
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="photos-title">
        <div className="section-head">
          <h2 id="photos-title">Progress photos</h2>
          <a className="link-btn" href="#/health/body">
            All photos
          </a>
        </div>
        <PhotoPair data={data} first={photos[0] ?? null} last={photos.length > 1 ? photos.at(-1)! : null} />
      </section>
    </>
  );
}

export function PhotoPair({ data, first, last }: { data: HealthSnapshot; first: HealthSnapshot['photos'][number] | null; last: HealthSnapshot['photos'][number] | null }) {
  const caption = (p: HealthSnapshot['photos'][number]) => {
    const w = [...data.weights].reverse().find((x) => x.date <= p.date);
    return (
      <figcaption>
        <strong>{formatDayMonthYear(p.date)}</strong>
        {w ? <span className="muted num"> {kg(w.kg)} kg</span> : null}
      </figcaption>
    );
  };
  if (!first) {
    return (
      <button className="empty empty-btn" onClick={() => openEditor({ kind: 'photo' })}>
        <strong>No progress photos yet.</strong>
        Send one to Claude, or click here to add one.
      </button>
    );
  }
  return (
    <div className="photo-pair">
      <figure>
        <button className="photo-btn" onClick={() => openEditor({ kind: 'photo', id: first.id })}>
          <img src={first.url} alt={`Progress photo, ${formatDayMonthYear(first.date)}`} loading="lazy" />
        </button>
        {caption(first)}
      </figure>
      {last ? (
        <figure>
          <button className="photo-btn" onClick={() => openEditor({ kind: 'photo', id: last.id })}>
            <img src={last.url} alt={`Progress photo, ${formatDayMonthYear(last.date)}`} loading="lazy" />
          </button>
          {caption(last)}
        </figure>
      ) : (
        <button className="photo-slot" onClick={() => openEditor({ kind: 'photo' })}>
          <IconCamera />
          <strong>Your next photo goes here</strong>
          <span className="muted">Same spot, same light, and you'll see the difference side by side.</span>
        </button>
      )}
    </div>
  );
}
