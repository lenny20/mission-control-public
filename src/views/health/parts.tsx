import { lastTime } from '../../../shared/health/metrics.ts';
import type { Exercise, HealthSnapshot, WorkoutSet } from '../../../shared/health/types.ts';
import type { Derived } from '../../health/derive.ts';
import { openEditor } from '../../health/editors.tsx';
import { api } from '../../lib/api.ts';
import { load } from '../../lib/format.ts';
import { mutate } from '../../lib/store.ts';
import { IconMessage, IconSkip } from '../../ui/icons.tsx';
import { toast } from '../../ui/toast.tsx';

/** "80 kg × 8, 8, 7" when the weight held; "80×8, 82.5×6" when it changed. */
export function describeSets(ex: Exercise, sets: WorkoutSet[]): string {
  const side = ex.unilateral ? ' each side' : '';
  if (ex.kind === 'reps') return `${sets.map((s) => s.reps).join(', ')} reps${side}`;
  const weights = new Set(sets.map((s) => s.kg ?? 0));
  const w = (v: number | null) => (ex.kind === 'bodyweight' ? (v ? `+${load(v)} kg` : 'bodyweight') : `${load(v)} kg`);
  if (weights.size === 1) return `${w(sets[0]!.kg)} × ${sets.map((s) => s.reps).join(', ')}${side}`;
  return sets.map((s) => `${ex.kind === 'bodyweight' ? (s.kg ? `+${load(s.kg)}` : 'BW') : load(s.kg)}×${s.reps}`).join(', ') + side;
}

// ------------------------------------------------------------------ next workout

export function NextWorkout({ data, d }: { data: HealthSnapshot; d: Derived }) {
  const next = d.cycle.next;
  const program = [...data.program].sort((a, b) => a.position - b.position);
  if (!next) {
    return (
      <div className="panel next-workout">
        <div className="empty">
          <strong>No program yet.</strong>
          <button className="link-btn" onClick={() => openEditor({ kind: 'program' })}>
            Set one up
          </button>
        </div>
      </div>
    );
  }

  const skip = async () => {
    try {
      const s = await mutate(() => api.post<{ id: number }>('/api/health/skips', { date: data.today, programDayId: next.id }));
      toast(`Skipped day ${next.position}`, 'ok', { label: 'Undo', run: () => void mutate(() => api.del(`/api/health/skips/${s.id}`)) });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <section className="panel next-workout" aria-labelledby="next-title">
      <div className="nw-top">
        <p className="nw-eyebrow">
          Next up, day {next.position} of {program.length}
        </p>
        <ol className="cycle" aria-label={`Cycle ${d.cycle.cycle}`}>
          {program.map((p) => {
            const state = d.cycle.done.has(p.id) ? 'done' : d.cycle.skipped.has(p.id) ? 'skipped' : p.id === next.id ? 'next' : 'todo';
            return (
              <li key={p.id} className={`cycle-step ${state}`} title={`Day ${p.position}: ${p.name} (${state === 'todo' ? 'to do' : state})`}>
                <span className="visually-hidden">
                  Day {p.position} {state}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <h2 id="next-title" className="nw-title">
        {next.name}
      </h2>
      <ul className="nw-list">
        {next.exercises.map((e, i) => {
          const ex = d.exById.get(e.exerciseId);
          if (!ex) return null;
          const last = lastTime(ex.id, data.workouts);
          return (
            <li key={`${e.exerciseId}${i}`}>
              <span className="nw-name">{ex.name}</span>
              <span className="nw-sets faint num">{e.sets} sets</span>
              <span className="nw-last num">{last ? describeSets(ex, last.sets) : <span className="faint">First time</span>}</span>
            </li>
          );
        })}
      </ul>
      <div className="nw-actions">
        <button className="btn btn-primary" onClick={() => openEditor({ kind: 'workout', programDayId: next.id })}>
          Log this workout
        </button>
        <button className="btn btn-quiet" onClick={skip}>
          <IconSkip /> Skip day {next.position}
        </button>
        <span className="nw-hint faint">
          <IconMessage /> Or send Claude a screenshot from the gym
        </span>
      </div>
    </section>
  );
}
