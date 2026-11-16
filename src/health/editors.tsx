// Every health edit happens in one of these drawers. Any screen opens one with
// `openEditor(...)`; the host renders whichever is open.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { formatLong, type DateStr } from '../../shared/dates.ts';
import { lastTime } from '../../shared/health/metrics.ts';
import type { Exercise, HealthSnapshot, Photo, ProgramDay, Workout } from '../../shared/health/types.ts';
import { api } from '../lib/api.ts';
import { kg as fmtKg, load } from '../lib/format.ts';
import { mutate, useHealth } from '../lib/store.ts';
import { DateField, fromNum, NumberField, TextField, toNum } from '../ui/fields.tsx';
import { IconChevronLeft, IconChevronRight, IconClose, IconPlus } from '../ui/icons.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { toast } from '../ui/toast.tsx';
import { confirmAction } from '../ui/confirm.tsx';

export type Editor =
  | { kind: 'day'; date?: DateStr }
  | { kind: 'workout'; id?: number; programDayId?: number | null; date?: DateStr }
  | { kind: 'program' }
  | { kind: 'photo'; id?: number };

let current: Editor | null = null;
const subs = new Set<() => void>();
export function openEditor(e: Editor | null) {
  current = e;
  subs.forEach((s) => s());
}

export function EditorHost() {
  const editor = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => current,
  );
  const { data } = useHealth();
  if (!editor || !data) return null;
  const close = () => openEditor(null);
  switch (editor.kind) {
    case 'day':
      return <DaySheet key={editor.date ?? 'new'} data={data} date={editor.date} onClose={close} />;
    case 'workout':
      return <WorkoutSheet key={editor.id ?? 'new'} data={data} editor={editor} onClose={close} />;
    case 'program':
      return <ProgramSheet data={data} onClose={close} />;
    case 'photo':
      return <PhotoSheet key={editor.id ?? 'new'} data={data} id={editor.id} onClose={close} />;
  }
}

/** Run a save, toast the outcome, and close on success. */
async function attempt(setError: (e: string | null) => void, fn: () => Promise<unknown>, done: string, onClose: () => void) {
  setError(null);
  try {
    await mutate(fn);
    toast(done);
    onClose();
  } catch (err) {
    setError((err as Error).message);
  }
}

// ------------------------------------------------------------------ a day: nutrition + weigh-in

function DaySheet({ data, date: initialDate, onClose }: { data: HealthSnapshot; date?: DateStr; onClose: () => void }) {
  const isNew = !initialDate;
  const [date, setDate] = useState(initialDate ?? data.today);
  const n = data.nutrition.find((x) => x.date === date) ?? null;
  const w = data.weights.find((x) => x.date === date) ?? null;
  // Fields always show what's stored for the chosen date, so picking a date
  // that already has data can never blank it out on save.
  const valuesFor = (d: DateStr) => {
    const nd = data.nutrition.find((x) => x.date === d);
    const wd = data.weights.find((x) => x.date === d);
    const prev = data.nutrition.filter((x) => x.date < d).at(-1) ?? data.nutrition.at(-1);
    return {
      eaten: fromNum(nd?.eatenKcal),
      target: fromNum(nd ? nd.targetKcal : prev?.targetKcal),
      burned: fromNum(nd?.burnedKcal ?? 0),
      protein: fromNum(nd?.proteinG),
      proteinT: fromNum(nd ? nd.proteinTargetG : prev?.proteinTargetG),
      carbs: fromNum(nd?.carbsG),
      carbsT: fromNum(nd ? nd.carbsTargetG : prev?.carbsTargetG),
      fat: fromNum(nd?.fatG),
      fatT: fromNum(nd ? nd.fatTargetG : prev?.fatTargetG),
      weight: fromNum(wd?.kg),
    };
  };
  // `loaded` is what the fields showed when filled in. Only the parts the
  // person actually changed are saved, so a field left blank never deletes
  // data that arrived (say, from Claude) while the drawer was open.
  const [loaded, setLoaded] = useState(() => valuesFor(date));
  const [f, setF] = useState(loaded);
  const fill = (d: DateStr) => {
    const v = valuesFor(d);
    setLoaded(v);
    setF(v);
  };
  const changeDate = (d: DateStr) => {
    setDate(d);
    if (d) fill(d);
  };
  const NUTRITION_KEYS = ['eaten', 'target', 'burned', 'protein', 'proteinT', 'carbs', 'carbsT', 'fat', 'fatT'] as const;
  const nutritionTouched = NUTRITION_KEYS.some((k) => f[k] !== loaded[k]);
  const weightTouched = f.weight !== loaded.weight;
  // New data for this day arrived and nothing's been typed: show it.
  const stamp = `${n?.updatedAt ?? ''}|${w?.kg ?? ''}`;
  useEffect(() => {
    if (!nutritionTouched && !weightTouched) fill(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const sourceImage = n?.sourceImage ?? w?.sourceImage;

  const save = () => {
    if (!nutritionTouched && !weightTouched) {
      onClose();
      return;
    }
    let nutrition: object | null | undefined;
    if (nutritionTouched) {
      if (f.eaten.trim()) {
        nutrition = {
          eatenKcal: toNum(f.eaten),
          targetKcal: toNum(f.target),
          burnedKcal: toNum(f.burned) ?? 0,
          proteinG: toNum(f.protein),
          proteinTargetG: toNum(f.proteinT),
          carbsG: toNum(f.carbs),
          carbsTargetG: toNum(f.carbsT),
          fatG: toNum(f.fat),
          fatTargetG: toNum(f.fatT),
          note: null,
        };
      } else if (loaded.eaten.trim()) {
        nutrition = null; // calories cleared on purpose: remove the day's food
      } else {
        setError('Fill in calories eaten to save the food for this day.');
        return;
      }
    }
    const weight = weightTouched ? (f.weight.trim() ? { kg: toNum(f.weight), macrauTrendKg: null, note: null } : null) : undefined;
    return attempt(setError, () => api.put(`/api/health/day/${date}`, { nutrition, weight }), `Saved ${formatLong(date)}`, onClose);
  };

  return (
    <Sheet
      title={isNew ? 'Add a day' : formatLong(date)}
      subtitle={isNew ? 'Food and weight for one day, as on the Macrau recap.' : n || w ? 'Change any number, or clear a field to remove it.' : 'Nothing logged for this day yet.'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={save}>
            Save day
          </button>
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      {isNew ? <DateField value={date} onChange={changeDate} max={data.today} /> : null}
      {isNew && (n || w) ? <p className="muted">This day already has data. Saving changes it.</p> : null}
      {error ? <div className="form-error">{error}</div> : null}
      <fieldset className="fieldset">
        <legend>Calories</legend>
        <div className="field-row">
          <NumberField label="Eaten" value={f.eaten} onChange={set('eaten')} unit="kcal" autoFocus={!isNew} />
          <NumberField label="Target" value={f.target} onChange={set('target')} unit="kcal" />
          <NumberField label="Burned" value={f.burned} onChange={set('burned')} unit="kcal" hint="Added back to the target" />
        </div>
      </fieldset>
      <fieldset className="fieldset">
        <legend>Macros</legend>
        <div className="macro-fields">
          <span className="dot" style={{ background: 'var(--protein)' }} />
          <NumberField label="Protein" value={f.protein} onChange={set('protein')} unit="g" />
          <NumberField label="Target" value={f.proteinT} onChange={set('proteinT')} unit="g" />
          <span className="dot" style={{ background: 'var(--carbs)' }} />
          <NumberField label="Carbs" value={f.carbs} onChange={set('carbs')} unit="g" />
          <NumberField label="Target" value={f.carbsT} onChange={set('carbsT')} unit="g" />
          <span className="dot" style={{ background: 'var(--fat)' }} />
          <NumberField label="Fat" value={f.fat} onChange={set('fat')} unit="g" />
          <NumberField label="Target" value={f.fatT} onChange={set('fatT')} unit="g" />
        </div>
      </fieldset>
      <fieldset className="fieldset">
        <legend>Weight</legend>
        <div className="field-row">
          <NumberField label="Weighed" value={f.weight} onChange={set('weight')} unit="kg" hint={w?.macrauTrendKg != null ? `Macrau's trend that day: ${fmtKg(w.macrauTrendKg)} kg` : undefined} />
        </div>
      </fieldset>
      {sourceImage ? (
        <a className="source-link" href={sourceImage} target="_blank" rel="noreferrer">
          <img src={sourceImage} alt="The screenshot this day was read from" />
          <span>
            <strong>Source screenshot</strong>
            <span className="muted">Open the original to check a number</span>
          </span>
        </a>
      ) : null}
    </Sheet>
  );
}

// ------------------------------------------------------------------ workout

type SetDraft = { kg: string; reps: string };
type EntryDraft = { exerciseId: string; sets: SetDraft[] };

function blankSets(n: number): SetDraft[] {
  return Array.from({ length: n }, () => ({ kg: '', reps: '' }));
}

function WorkoutSheet({ data, editor, onClose }: { data: HealthSnapshot; editor: Extract<Editor, { kind: 'workout' }>; onClose: () => void }) {
  const existing: Workout | null = editor.id ? (data.workouts.find((w) => w.id === editor.id) ?? null) : null;
  const exById = useMemo(() => new Map(data.exercises.map((e) => [e.id, e])), [data.exercises]);
  const program = [...data.program].sort((a, b) => a.position - b.position);

  const fromDay = (dayId: number | null): EntryDraft[] => {
    const day = program.find((d) => d.id === dayId);
    return day ? day.exercises.map((e) => ({ exerciseId: e.exerciseId, sets: blankSets(e.sets) })) : [];
  };

  const [date, setDate] = useState(existing?.date ?? editor.date ?? data.today);
  const [dayId, setDayId] = useState<number | null>(existing ? existing.programDayId : (editor.programDayId ?? null));
  const [note, setNote] = useState(existing?.note ?? '');
  const [entries, setEntries] = useState<EntryDraft[]>(() =>
    existing ? existing.exercises.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets.map((s) => ({ kg: fromNum(s.kg), reps: String(s.reps) })) })) : fromDay(editor.programDayId ?? null),
  );
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);

  const changeDay = (v: string) => {
    const id = v ? Number(v) : null;
    setDayId(id);
    // Only refill from the template while nothing has been typed in.
    if (!existing && entries.every((e) => e.sets.every((s) => !s.kg && !s.reps))) setEntries(fromDay(id));
  };

  const update = (i: number, fn: (e: EntryDraft) => EntryDraft) => setEntries((es) => es.map((e, j) => (j === i ? fn(e) : e)));

  const save = () => {
    const exercises = entries
      .map((e) => ({
        exerciseId: e.exerciseId,
        sets: e.sets.filter((s) => s.reps.trim()).map((s) => ({ kg: exById.get(e.exerciseId)?.kind === 'reps' ? null : (toNum(s.kg) ?? (exById.get(e.exerciseId)?.kind === 'bodyweight' ? 0 : null)), reps: Number(s.reps) })),
      }))
      .filter((e) => e.sets.length);
    if (!exercises.length) {
      setError('Fill in the reps for at least one set. Leave a set blank to skip it.');
      return;
    }
    const body = { date, programDayId: dayId, note: note.trim() || null, exercises };
    return attempt(setError, () => (existing ? api.put(`/api/health/workouts/${existing.id}`, body) : api.post('/api/health/workouts', body)), existing ? 'Workout updated' : 'Workout logged', onClose);
  };

  const remove = async () => {
    if (existing && (await confirmDelete('this workout'))) await attempt(setError, () => api.del(`/api/health/workouts/${existing.id}`), 'Workout deleted', onClose);
  };

  const unused = data.exercises.filter((e) => !entries.some((x) => x.exerciseId === e.id));

  return (
    <Sheet
      title={existing ? `Workout, ${formatLong(existing.date)}` : 'Log a workout'}
      subtitle="Leave a set blank to skip it. Grey numbers are last time's."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={save}>
            {existing ? 'Save workout' : 'Log workout'}
          </button>
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <span className="spacer" />
          {existing ? (
            <button className="btn btn-danger" onClick={remove}>
              Delete
            </button>
          ) : null}
        </>
      }
    >
      <div className="field-row">
        <DateField value={date} onChange={setDate} max={data.today} />
        <label className="field">
          <span>Program day</span>
          <select value={dayId ?? ''} onChange={(e) => changeDay(e.target.value)}>
            <option value="">Not part of the program</option>
            {program.map((d) => (
              <option key={d.id} value={d.id}>
                Day {d.position}: {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="entries">
        {entries.map((entry, i) => {
          const ex = exById.get(entry.exerciseId);
          if (!ex) return null;
          const last = lastTime(ex.id, data.workouts.filter((w) => w.id !== existing?.id), date);
          return (
            <div className="entry" key={`${entry.exerciseId}${i}`}>
              <div className="entry-head">
                <strong>{ex.name}</strong>
                <span className="faint">{describeKind(ex)}</span>
                <button className="btn btn-quiet icon-btn" aria-label={`Remove ${ex.name}`} onClick={() => setEntries((es) => es.filter((_, j) => j !== i))}>
                  <IconClose />
                </button>
              </div>
              <div className="set-grid">
                <span className="faint">Set</span>
                {ex.kind !== 'reps' ? <span className="faint">{ex.kind === 'bodyweight' ? 'Added kg' : ex.equipment === 'dumbbell' ? 'kg each' : 'kg'}</span> : <span />}
                <span className="faint">{ex.unilateral ? 'Reps each side' : 'Reps'}</span>
                <span />
                {entry.sets.map((s, j) => {
                  const prev = last?.sets[j] ?? last?.sets.at(-1);
                  return (
                    <SetRow
                      key={j}
                      n={j + 1}
                      set={s}
                      ex={ex}
                      placeholder={prev ? { kg: prev.kg == null ? '' : load(prev.kg), reps: String(prev.reps) } : null}
                      onChange={(ns) => update(i, (e) => ({ ...e, sets: e.sets.map((x, k) => (k === j ? ns : x)) }))}
                      onRemove={entry.sets.length > 1 ? () => update(i, (e) => ({ ...e, sets: e.sets.filter((_, k) => k !== j) })) : undefined}
                    />
                  );
                })}
              </div>
              <button className="btn btn-quiet btn-sm" onClick={() => update(i, (e) => ({ ...e, sets: [...e.sets, { kg: e.sets.at(-1)?.kg ?? '', reps: '' }] }))}>
                <IconPlus /> Add set
              </button>
            </div>
          );
        })}
      </div>
      <label className="field">
        <span>Add an exercise</span>
        <select
          value={adding}
          onChange={(e) => {
            const id = e.target.value;
            setAdding('');
            if (id) setEntries((es) => [...es, { exerciseId: id, sets: blankSets(3) }]);
          }}
        >
          <option value="">Choose…</option>
          {unused.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <TextField label="Note" value={note} onChange={setNote} multiline placeholder="How it felt, anything to remember next time" />
      {existing?.sourceImage ? (
        <a className="source-link" href={existing.sourceImage} target="_blank" rel="noreferrer">
          <img src={existing.sourceImage} alt="The screenshot this workout was read from" />
          <span>
            <strong>Source screenshot</strong>
            <span className="muted">Open the original to check a number</span>
          </span>
        </a>
      ) : null}
    </Sheet>
  );
}

function describeKind(ex: Exercise): string {
  if (ex.kind === 'bodyweight') return 'Bodyweight plus added weight';
  if (ex.kind === 'reps') return 'Reps only';
  if (ex.unilateral) return 'Per side';
  return '';
}

function SetRow({ n, set, ex, placeholder, onChange, onRemove }: { n: number; set: SetDraft; ex: Exercise; placeholder: { kg: string; reps: string } | null; onChange: (s: SetDraft) => void; onRemove?: () => void }) {
  return (
    <>
      <span className="set-n num">{n}</span>
      {ex.kind !== 'reps' ? (
        <input className="input set-input" type="number" inputMode="decimal" step="any" aria-label={`Set ${n} weight`} placeholder={placeholder?.kg ?? (ex.kind === 'bodyweight' ? '0' : '')} value={set.kg} onChange={(e) => onChange({ ...set, kg: e.target.value })} />
      ) : (
        <span />
      )}
      <input className="input set-input" type="number" inputMode="numeric" step="1" aria-label={`Set ${n} reps`} placeholder={placeholder?.reps ?? ''} value={set.reps} onChange={(e) => onChange({ ...set, reps: e.target.value })} />
      {onRemove ? (
        <button className="btn btn-quiet icon-btn" aria-label={`Remove set ${n}`} onClick={onRemove}>
          <IconClose />
        </button>
      ) : (
        <span />
      )}
    </>
  );
}

function confirmDelete(what: string) {
  return confirmAction({ title: `Delete ${what}?`, body: "This can't be undone." });
}

// ------------------------------------------------------------------ program

function ProgramSheet({ data, onClose }: { data: HealthSnapshot; onClose: () => void }) {
  const exById = new Map(data.exercises.map((e) => [e.id, e]));
  const [days, setDays] = useState<(Omit<ProgramDay, 'position' | 'id'> & { id?: number })[]>(() =>
    [...data.program].sort((a, b) => a.position - b.position).map((d) => ({ id: d.id, name: d.name, exercises: d.exercises.map((e) => ({ ...e })) })),
  );
  const [error, setError] = useState<string | null>(null);
  const updateDay = (i: number, fn: (d: (typeof days)[number]) => (typeof days)[number]) => setDays((ds) => ds.map((d, j) => (j === i ? fn(d) : d)));
  const move = <T,>(list: T[], from: number, to: number) => {
    if (to < 0 || to >= list.length) return list;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    return next;
  };

  const save = () => attempt(setError, () => api.put('/api/health/program', days), 'Program saved', onClose);

  return (
    <Sheet
      title="Edit program"
      subtitle="Changes apply from your next workout. Past workouts keep what you actually did."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={save}>
            Save program
          </button>
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      {days.map((day, i) => (
        <div className="program-edit-day" key={day.id ?? `new${i}`}>
          <div className="program-edit-head">
            <span className="day-num">{i + 1}</span>
            <input className="input" aria-label={`Day ${i + 1} name`} value={day.name} onChange={(e) => updateDay(i, (d) => ({ ...d, name: e.target.value }))} />
            <button className="btn btn-quiet icon-btn" aria-label="Move day earlier" disabled={i === 0} onClick={() => setDays((ds) => move(ds, i, i - 1))}>
              <IconChevronLeft className="rot90" />
            </button>
            <button className="btn btn-quiet icon-btn" aria-label="Move day later" disabled={i === days.length - 1} onClick={() => setDays((ds) => move(ds, i, i + 1))}>
              <IconChevronRight className="rot90" />
            </button>
            <button className="btn btn-quiet icon-btn" aria-label={`Remove day ${i + 1}`} disabled={days.length === 1} onClick={() => setDays((ds) => ds.filter((_, j) => j !== i))}>
              <IconClose />
            </button>
          </div>
          <ol className="program-edit-list">
            {day.exercises.map((e, j) => (
              <li key={`${e.exerciseId}${j}`}>
                <span className="grow">{exById.get(e.exerciseId)?.name ?? e.exerciseId}</span>
                <label className="sets-input">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={20}
                    value={e.sets}
                    aria-label="Sets"
                    onChange={(ev) => updateDay(i, (d) => ({ ...d, exercises: d.exercises.map((x, k) => (k === j ? { ...x, sets: Math.max(1, Number(ev.target.value) || 1) } : x)) }))}
                  />
                  <span className="faint">sets</span>
                </label>
                <button className="btn btn-quiet icon-btn" aria-label="Move up" disabled={j === 0} onClick={() => updateDay(i, (d) => ({ ...d, exercises: move(d.exercises, j, j - 1) }))}>
                  <IconChevronLeft className="rot90" />
                </button>
                <button className="btn btn-quiet icon-btn" aria-label="Move down" disabled={j === day.exercises.length - 1} onClick={() => updateDay(i, (d) => ({ ...d, exercises: move(d.exercises, j, j + 1) }))}>
                  <IconChevronRight className="rot90" />
                </button>
                <button className="btn btn-quiet icon-btn" aria-label="Remove exercise" onClick={() => updateDay(i, (d) => ({ ...d, exercises: d.exercises.filter((_, k) => k !== j) }))}>
                  <IconClose />
                </button>
              </li>
            ))}
          </ol>
          <select
            className="input"
            value=""
            aria-label={`Add an exercise to day ${i + 1}`}
            onChange={(ev) => ev.target.value && updateDay(i, (d) => ({ ...d, exercises: [...d.exercises, { exerciseId: ev.target.value, sets: 3 }] }))}
          >
            <option value="">Add an exercise…</option>
            {data.exercises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button className="btn" onClick={() => setDays((ds) => [...ds, { name: `Day ${ds.length + 1}`, exercises: [] }])}>
        <IconPlus /> Add a day
      </button>
    </Sheet>
  );
}

// ------------------------------------------------------------------ photo

function PhotoSheet({ data, id, onClose }: { data: HealthSnapshot; id?: number; onClose: () => void }) {
  const existing: Photo | null = id ? (data.photos.find((p) => p.id === id) ?? null) : null;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [date, setDate] = useState(existing?.date ?? data.today);
  // A new photo defaults to front; an existing one keeps exactly the pose it has, even none.
  const [pose, setPose] = useState<string>(existing ? (existing.pose ?? '') : 'front');
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const choose = (f: File | null) => {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const save = () => {
    if (existing) {
      return attempt(setError, () => api.put(`/api/health/photos/${existing.id}`, { date, pose: pose || null, note: note.trim() || null }), 'Photo updated', onClose);
    }
    if (!file) {
      setError('Choose a photo first.');
      return;
    }
    const form = new FormData();
    form.set('file', file);
    form.set('date', date);
    if (pose) form.set('pose', pose);
    if (note.trim()) form.set('note', note.trim());
    return attempt(setError, () => api.post('/api/health/photos', form), 'Photo added', onClose);
  };

  const remove = async () => {
    if (existing && (await confirmDelete('this photo'))) await attempt(setError, () => api.del(`/api/health/photos/${existing.id}`), 'Photo deleted', onClose);
  };

  return (
    <Sheet
      title={existing ? 'Progress photo' : 'Add a progress photo'}
      subtitle={existing ? formatLong(existing.date) : 'Stays on this computer, never in git.'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={save}>
            {existing ? 'Save photo' : 'Add photo'}
          </button>
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <span className="spacer" />
          {existing ? (
            <button className="btn btn-danger" onClick={remove}>
              Delete
            </button>
          ) : null}
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      {existing || preview ? (
        <img className="photo-preview" src={existing?.url ?? preview!} alt="Progress photo" />
      ) : (
        <label
          className="drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            choose(e.dataTransfer.files[0] ?? null);
          }}
        >
          <input type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
          <strong>Drop a photo here</strong>
          <span className="muted">or click to choose one</span>
        </label>
      )}
      <div className="field-row">
        <DateField value={date} onChange={setDate} max={data.today} />
        <label className="field">
          <span>Pose</span>
          <select value={pose} onChange={(e) => setPose(e.target.value)}>
            <option value="front">Front</option>
            <option value="side">Side</option>
            <option value="back">Back</option>
            <option value="">Other</option>
          </select>
        </label>
      </div>
      <TextField label="Note" value={note} onChange={setNote} placeholder="Optional" />
    </Sheet>
  );
}
