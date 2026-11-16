import { formatDayMonthYear, formatDow, formatShort } from '../../../shared/dates.ts';
import { repRecords } from '../../../shared/health/metrics.ts';
import type { HealthSnapshot } from '../../../shared/health/types.ts';
import { LiftChart, sessionPoints } from '../../charts/LiftChart.tsx';
import { VolumeChart } from '../../charts/VolumeChart.tsx';
import type { Derived } from '../../health/derive.ts';
import { openEditor } from '../../health/editors.tsx';
import { load, oneRm, plural, signed } from '../../lib/format.ts';
import { href } from '../../lib/router.ts';
import { IconChevronLeft, IconTrophy } from '../../ui/icons.tsx';
import { describeSets, NextWorkout } from './parts.tsx';

export function Training({ data, d, liftId }: { data: HealthSnapshot; d: Derived; liftId?: string }) {
  if (liftId && d.exById.has(liftId)) return <LiftDetail d={d} liftId={liftId} />;

  const program = [...data.program].sort((a, b) => a.position - b.position);
  const history = [...data.workouts].reverse();
  const trained = d.lifts.filter((l) => d.sessions.has(l.id));
  const untrained = d.lifts.filter((l) => !d.sessions.has(l.id));

  return (
    <>
      <div className="training-top">
        <NextWorkout data={data} d={d} />
        <section className="block program" aria-labelledby="program-title">
          <div className="block-head">
            <h2 id="program-title" className="block-title">
              Program
            </h2>
            <button className="link-btn" onClick={() => openEditor({ kind: 'program' })}>
              Edit
            </button>
          </div>
          <ol className="program-list panel-list">
            {program.map((p) => {
              const state = d.cycle.done.has(p.id) ? 'done' : d.cycle.skipped.has(p.id) ? 'skipped' : p.id === d.cycle.next?.id ? 'next' : 'todo';
              return (
                <li key={p.id} className={`program-day ${state}`}>
                  <span className="day-num">{p.position}</span>
                  <span className="program-day-text">
                    <strong>{p.name}</strong>
                    <span className="faint">{p.exercises.map((e) => d.exById.get(e.exerciseId)?.name).join(', ')}</span>
                  </span>
                  <span className="program-state">{state === 'done' ? 'Done' : state === 'skipped' ? 'Skipped' : state === 'next' ? 'Next' : ''}</span>
                </li>
              );
            })}
          </ol>
          <p className="faint small">Cycle {d.cycle.cycle}. A new cycle starts once all program days are done or skipped.</p>
        </section>
      </div>

      <section className="section" aria-labelledby="lifts-title">
        <div className="section-head">
          <h2 id="lifts-title">Lifts</h2>
          <p>Click a lift for its records and full history.</p>
        </div>
        {trained.length ? (
          <div className="lift-grid">
            {trained.map((ex) => {
              const sessions = d.sessions.get(ex.id)!;
              const { points, metric } = sessionPoints(sessions);
              const last = points.at(-1)!;
              const first = points[0]!;
              const prs = sessions.reduce((n, s) => n + s.sets.filter((x) => x.pr).length, 0);
              return (
                <a key={ex.id} className="lift-card" href={href({ area: 'health', tab: 'training', param: ex.id })}>
                  <span className="lift-name">{ex.name}</span>
                  <span className="lift-value num">
                    {metric === 'e1rm' ? oneRm(last.value) : load(last.value)} <span className="faint">{metric === 'e1rm' ? 'kg' : 'reps'}</span>
                  </span>
                  <span className="lift-delta faint num">
                    {points.length > 1 ? `${signed(last.value - first.value, metric === 'e1rm' ? oneRm : load)} since ${formatShort(first.date)}` : 'One session so far'}
                    {prs ? `, ${plural(prs, 'PR')}` : ''}
                  </span>
                  <LiftChart sessions={sessions} height={64} compact />
                </a>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <strong>No lifts logged yet.</strong>
            Log a workout, or send Claude a screenshot from your gym app.
          </div>
        )}
        {untrained.length ? (
          <p className="untrained-line">
            <span className="faint">Not logged yet: </span>
            {untrained.map((ex, i) => (
              <span key={ex.id}>
                <a href={href({ area: 'health', tab: 'training', param: ex.id })}>{ex.name}</a>
                {i < untrained.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>
        ) : null}
      </section>

      {d.volume.length ? (
        <section className="section" aria-labelledby="volume-title">
          <div className="section-head">
            <h2 id="volume-title">Weekly volume</h2>
            <p>Weight × reps, all lifts. Single-side lifts count both sides.</p>
          </div>
          <div className="chart-panel">
            <VolumeChart weeks={d.volume.slice(-16)} />
          </div>
        </section>
      ) : null}

      <section className="section" aria-labelledby="history-title">
        <div className="section-head">
          <h2 id="history-title">Workouts</h2>
          <button className="btn btn-sm" onClick={() => openEditor({ kind: 'workout', programDayId: d.cycle.next?.id ?? null })}>
            Log a workout
          </button>
        </div>
        {history.length ? (
          <ul className="workout-list">
            {history.map((w) => {
              const sets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
              return (
                <li key={w.id}>
                  <button className="workout-row" onClick={() => openEditor({ kind: 'workout', id: w.id })}>
                    <span className="workout-date">
                      <strong>{formatDow(w.date)}</strong> <span className="muted">{formatShort(w.date)}</span>
                    </span>
                    <span className="workout-name">{w.programDayName ?? 'Off-program'}</span>
                    <span className="workout-meta faint num">
                      {plural(w.exercises.length, 'exercise')}, {plural(sets, 'set')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty">
            <strong>No workouts yet.</strong>
            Log one here, or send Claude a screenshot from your gym app.
          </div>
        )}
      </section>
    </>
  );
}

function LiftDetail({ d, liftId }: { d: Derived; liftId: string }) {
  const ex = d.exById.get(liftId)!;
  const sessions = d.sessions.get(liftId) ?? [];
  const records = repRecords(sessions);
  const { points, metric } = sessionPoints(sessions);
  const last = points.at(-1);
  const best = points.reduce<(typeof points)[number] | null>((m, p) => (!m || p.value > m.value ? p : m), null);

  return (
    <>
      <a className="back-link" href={href({ area: 'health', tab: 'training' })}>
        <IconChevronLeft /> Training
      </a>
      <header className="lift-head">
        <h2 className="lift-title">{ex.name}</h2>
        <p className="muted">
          {ex.kind === 'bodyweight'
            ? 'Load is your bodyweight that day plus any added weight.'
            : ex.kind === 'reps'
              ? 'Tracked by reps.'
              : ex.equipment === 'dumbbell'
                ? `Weight is per dumbbell${ex.unilateral ? ', reps per side' : ''}.`
                : ex.unilateral
                  ? 'Reps are per side.'
                  : ''}
          {ex.aliases.length ? ` Claude also understands: ${ex.aliases.join(', ')}.` : ''}
        </p>
      </header>
      {!sessions.length ? (
        <div className="empty">
          <strong>Not logged yet.</strong>
          Once you've done {ex.name.toLowerCase()} and logged it, its estimated max, records and history appear here.
        </div>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-label">{metric === 'e1rm' ? 'Estimated 1RM, latest' : 'Best reps, latest'}</span>
              <span className="stat-value">
                {metric === 'e1rm' ? oneRm(last!.value) : load(last!.value)}
                <span className="stat-unit">{metric === 'e1rm' ? 'kg' : 'reps'}</span>
              </span>
              <span className="stat-sub">{formatDayMonthYear(last!.date)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">All-time best</span>
              <span className="stat-value">
                {metric === 'e1rm' ? oneRm(best!.value) : load(best!.value)}
                <span className="stat-unit">{metric === 'e1rm' ? 'kg' : 'reps'}</span>
              </span>
              <span className="stat-sub">{formatDayMonthYear(best!.date)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Sessions</span>
              <span className="stat-value">{sessions.length}</span>
              <span className="stat-sub">Since {formatDayMonthYear(sessions[0]!.date)}</span>
            </div>
          </div>
          <section className="section">
            <div className="section-head">
              <h2>{metric === 'e1rm' ? 'Estimated one-rep max' : 'Best set'}</h2>
              <p>{metric === 'e1rm' ? 'From your best set each session.' : 'Most reps in a set, each session.'}</p>
            </div>
            <div className="chart-panel">
              <LiftChart sessions={sessions} height={260} />
            </div>
          </section>
          {records.length ? (
            <section className="section">
              <div className="section-head">
                <h2>Rep records</h2>
                <p>The heaviest you've lifted for each number of reps.</p>
              </div>
              <div className="records">
                {records.map((r) => (
                  <div key={r.reps} className="record">
                    <span className="record-reps num">{r.reps}</span>
                    <span className="faint">{r.reps === 1 ? 'rep' : 'reps'}</span>
                    <strong className="num">{load(r.load)} kg</strong>
                    <span className="faint small">{formatShort(r.date)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <section className="section">
            <div className="section-head">
              <h2>History</h2>
            </div>
            <ul className="session-list">
              {[...sessions].reverse().map((s) => (
                <li key={s.workoutId}>
                  <button className="session-row" onClick={() => openEditor({ kind: 'workout', id: s.workoutId })}>
                    <span>
                      <strong>{formatDow(s.date)}</strong> <span className="muted">{formatShort(s.date)}</span>
                    </span>
                    <span className="session-sets num">
                      {s.sets.map((set, i) => (
                        <span key={i} className={`set-pill ${set === s.best ? 'best' : ''}`}>
                          {set.pr ? <IconTrophy className="pr-icon" title="Personal record" /> : null}
                          {describeSets(ex, [set])}
                        </span>
                      ))}
                    </span>
                    <span className="faint num">{s.bestE1rm != null ? `${oneRm(s.bestE1rm)} kg est. 1RM` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
