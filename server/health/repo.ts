// The one save path for health data. The logging command and the HTTP API both
// call these functions, so every write passes the same checks.

import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { today, type DateStr } from '../../shared/dates.ts';
import {
  exerciseInput,
  nutritionInput,
  photoMetaInput,
  programInput,
  recapInput,
  skipInput,
  weightInput,
  workoutInput,
  type ExerciseInput,
  type NutritionInput,
  type PhotoMetaInput,
  type ProgramInput,
  type RecapInput,
  type SkipInput,
  type Source,
  type WeightInput,
  type WorkoutInput,
} from '../../shared/health/schemas.ts';
import { cycleState } from '../../shared/health/metrics.ts';
import type {
  Exercise,
  HealthSnapshot,
  NutritionDay,
  Photo,
  ProgramDay,
  Skip,
  WeightEntry,
  Workout,
} from '../../shared/health/types.ts';
import { config, paths } from '../config.ts';
import { transaction, type Db } from '../db.ts';
import { ConflictError, UserError } from '../errors.ts';
import { fileUrl, imageSize, storeImage } from '../files.ts';

export type SaveMode = 'create' | 'replace';
export type SaveOutcome = 'created' | 'updated' | 'unchanged';
type Origin = { source: Source; sourceImage?: string | null };

const now = () => new Date().toISOString();

// ------------------------------------------------------------------ reads

type Row = Record<string, unknown>;
const num = (v: unknown) => (v == null ? null : Number(v));
const str = (v: unknown) => (v == null ? null : String(v));

function rowToNutrition(r: Row): NutritionDay {
  return {
    date: String(r.date),
    eatenKcal: Number(r.eaten_kcal),
    targetKcal: num(r.target_kcal),
    burnedKcal: Number(r.burned_kcal),
    proteinG: num(r.protein_g),
    proteinTargetG: num(r.protein_target_g),
    carbsG: num(r.carbs_g),
    carbsTargetG: num(r.carbs_target_g),
    fatG: num(r.fat_g),
    fatTargetG: num(r.fat_target_g),
    note: str(r.note),
    source: r.source as Source,
    sourceImage: fileUrl(str(r.source_image)),
    updatedAt: String(r.updated_at),
  };
}

function rowToWeight(r: Row): WeightEntry {
  return {
    date: String(r.date),
    kg: Number(r.kg),
    macrauTrendKg: num(r.macrau_trend_kg),
    note: str(r.note),
    source: r.source as Source,
    sourceImage: fileUrl(str(r.source_image)),
  };
}

function rowToExercise(r: Row): Exercise {
  return {
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as Exercise['kind'],
    equipment: r.equipment as Exercise['equipment'],
    unilateral: Boolean(r.unilateral),
    aliases: JSON.parse(String(r.aliases)) as string[],
  };
}

export function getNutrition(db: Db, date: DateStr): NutritionDay | null {
  const r = db.prepare('SELECT * FROM nutrition_days WHERE date = ?').get(date) as Row | undefined;
  return r ? rowToNutrition(r) : null;
}

export function getWeight(db: Db, date: DateStr): WeightEntry | null {
  const r = db.prepare('SELECT * FROM weights WHERE date = ?').get(date) as Row | undefined;
  return r ? rowToWeight(r) : null;
}

export function listExercises(db: Db): Exercise[] {
  return (db.prepare('SELECT * FROM exercises ORDER BY name').all() as Row[]).map(rowToExercise);
}

export function getProgram(db: Db): ProgramDay[] {
  const days = db.prepare('SELECT * FROM program_days ORDER BY position').all() as Row[];
  const ex = db.prepare('SELECT * FROM program_exercises ORDER BY day_id, position').all() as Row[];
  return days.map((d) => ({
    id: Number(d.id),
    position: Number(d.position),
    name: String(d.name),
    exercises: ex
      .filter((e) => Number(e.day_id) === Number(d.id))
      .map((e) => ({ exerciseId: String(e.exercise_id), sets: Number(e.sets) })),
  }));
}

export function listWorkouts(db: Db): Workout[] {
  const ws = db.prepare('SELECT * FROM workouts ORDER BY date, id').all() as Row[];
  const sets = db.prepare('SELECT * FROM workout_sets ORDER BY workout_id, exercise_pos, set_pos').all() as Row[];
  const byWorkout = new Map<number, Row[]>();
  for (const s of sets) {
    const id = Number(s.workout_id);
    byWorkout.set(id, [...(byWorkout.get(id) ?? []), s]);
  }
  return ws.map((w) => {
    const exercises: Workout['exercises'] = [];
    for (const s of byWorkout.get(Number(w.id)) ?? []) {
      const pos = Number(s.exercise_pos);
      exercises[pos] ??= { exerciseId: String(s.exercise_id), sets: [] };
      exercises[pos].sets.push({ kg: num(s.kg), reps: Number(s.reps) });
    }
    return {
      id: Number(w.id),
      date: String(w.date),
      programDayId: num(w.program_day_id),
      programDayName: str(w.program_day_name),
      note: str(w.note),
      source: w.source as Source,
      sourceImage: fileUrl(str(w.source_image)),
      createdAt: String(w.created_at),
      exercises: exercises.filter(Boolean),
    };
  });
}

export function getWorkout(db: Db, id: number): Workout | null {
  return listWorkouts(db).find((w) => w.id === id) ?? null;
}

function rowToPhoto(r: Row): Photo {
  return {
    id: Number(r.id),
    date: String(r.date),
    url: fileUrl(String(r.file))!,
    pose: (r.pose ?? null) as Photo['pose'],
    note: str(r.note),
    width: num(r.width),
    height: num(r.height),
    createdAt: String(r.created_at),
  };
}

export function snapshot(db: Db, today: DateStr): HealthSnapshot {
  return {
    today,
    nutrition: (db.prepare('SELECT * FROM nutrition_days ORDER BY date').all() as Row[]).map(rowToNutrition),
    weights: (db.prepare('SELECT * FROM weights ORDER BY date').all() as Row[]).map(rowToWeight),
    exercises: listExercises(db),
    program: getProgram(db),
    workouts: listWorkouts(db),
    skips: (db.prepare('SELECT * FROM skips ORDER BY date, id').all() as Row[]).map(
      (r): Skip => ({ id: Number(r.id), date: String(r.date), programDayId: Number(r.program_day_id), createdAt: String(r.created_at) }),
    ),
    photos: (db.prepare('SELECT * FROM photos ORDER BY date, id').all() as Row[]).map(rowToPhoto),
  };
}

// ------------------------------------------------------------------ nutrition & weight

/** The numbers that make a nutrition day. Notes aren't compared: a recap never carries one. */
const NUTRITION_FIELDS = [
  'eatenKcal',
  'targetKcal',
  'burnedKcal',
  'proteinG',
  'proteinTargetG',
  'carbsG',
  'carbsTargetG',
  'fatG',
  'fatTargetG',
] as const;

function sameValues<T extends object>(a: T, b: T, keys: readonly (keyof T)[]): boolean {
  return keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/** Nothing can be logged for a day that hasn't happened, which catches a misread year. */
export function checkNotFuture(date: DateStr) {
  const now = today(config.timeZone);
  if (date > now) throw new UserError(`${date} is in the future. Check the date (and the year).`);
}

export function saveNutrition(db: Db, raw: unknown, origin: Origin, mode: SaveMode = 'create') {
  const input: NutritionInput = nutritionInput.parse(raw);
  checkNotFuture(input.date);
  const existing = getNutrition(db, input.date);
  // A save without a note keeps the one already there.
  const note = input.note ?? existing?.note ?? null;
  if (existing && sameValues<NutritionInput>(existing, input, NUTRITION_FIELDS) && note === existing.note) {
    return { outcome: 'unchanged' as SaveOutcome, day: existing };
  }
  if (existing && mode === 'create' && !sameValues<NutritionInput>(existing, input, NUTRITION_FIELDS)) {
    throw new ConflictError(`${input.date} already has nutrition logged with different numbers.`, existing);
  }
  db.prepare(
    `INSERT INTO nutrition_days (date, eaten_kcal, target_kcal, burned_kcal, protein_g, protein_target_g,
       carbs_g, carbs_target_g, fat_g, fat_target_g, note, source, source_image, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       eaten_kcal = excluded.eaten_kcal, target_kcal = excluded.target_kcal, burned_kcal = excluded.burned_kcal,
       protein_g = excluded.protein_g, protein_target_g = excluded.protein_target_g,
       carbs_g = excluded.carbs_g, carbs_target_g = excluded.carbs_target_g,
       fat_g = excluded.fat_g, fat_target_g = excluded.fat_target_g, note = excluded.note,
       source = excluded.source,
       source_image = COALESCE(excluded.source_image, nutrition_days.source_image),
       updated_at = excluded.updated_at`,
  ).run(
    input.date,
    input.eatenKcal,
    input.targetKcal,
    input.burnedKcal,
    input.proteinG,
    input.proteinTargetG,
    input.carbsG,
    input.carbsTargetG,
    input.fatG,
    input.fatTargetG,
    note,
    origin.source,
    origin.sourceImage ?? null,
    now(),
  );
  return { outcome: (existing ? 'updated' : 'created') as SaveOutcome, day: getNutrition(db, input.date)! };
}

/**
 * Create mode: a different weight on the same day is a clash; the same weight
 * only fills in a trend figure or note that was missing. Replace mode: the new
 * values win. In both, a missing trend or note keeps what's stored.
 */
export function saveWeight(db: Db, raw: unknown, origin: Origin, mode: SaveMode = 'create') {
  const input: WeightInput = weightInput.parse(raw);
  checkNotFuture(input.date);
  const existing = getWeight(db, input.date);
  if (existing && mode === 'create' && existing.kg !== input.kg) {
    throw new ConflictError(`${input.date} already has a weigh-in of ${existing.kg} kg.`, existing);
  }
  const next =
    existing && mode === 'create'
      ? { kg: existing.kg, macrauTrendKg: existing.macrauTrendKg ?? input.macrauTrendKg, note: existing.note ?? input.note }
      : { kg: input.kg, macrauTrendKg: input.macrauTrendKg ?? existing?.macrauTrendKg ?? null, note: input.note ?? existing?.note ?? null };
  if (existing && sameValues(existing, next, ['kg', 'macrauTrendKg', 'note'])) {
    return { outcome: 'unchanged' as SaveOutcome, weight: existing };
  }
  db.prepare(
    `INSERT INTO weights (date, kg, macrau_trend_kg, note, source, source_image, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET kg = excluded.kg, macrau_trend_kg = excluded.macrau_trend_kg,
       note = excluded.note, source = excluded.source,
       source_image = COALESCE(excluded.source_image, weights.source_image), updated_at = excluded.updated_at`,
  ).run(input.date, next.kg, next.macrauTrendKg, next.note, origin.source, origin.sourceImage ?? null, now());
  return { outcome: (existing ? 'updated' : 'created') as SaveOutcome, weight: getWeight(db, input.date)! };
}

/**
 * A Macrau daily recap. The recap shows the latest weigh-in on or before its
 * day; when that weigh-in is from an earlier day it carries a date label, and
 * the weight belongs to that labelled date instead.
 */
export function saveRecap(db: Db, raw: unknown, origin: Origin, mode: SaveMode = 'create') {
  const input: RecapInput = recapInput.parse(raw);
  return transaction(db, () => {
    const { weight, ...nutrition } = input;
    const n = saveNutrition(db, nutrition, origin, mode);
    let w: ReturnType<typeof saveWeight> | { outcome: 'skipped'; reason: string } | null = null;
    if (weight) {
      const date = weight.labelledDate ?? input.date;
      if (weight.labelledDate && weight.labelledDate > input.date) {
        throw new UserError(`The weight's date label (${weight.labelledDate}) is after the recap's date (${input.date}).`);
      }
      const existing = getWeight(db, date);
      if (weight.labelledDate && existing) {
        w = { outcome: 'skipped', reason: `${date} already has a weigh-in (${existing.kg} kg)` };
      } else {
        // The recap's trend figure is Macrau's view on the recap's day, so it
        // isn't filed against an earlier labelled weigh-in.
        const trend = weight.labelledDate ? null : weight.macrauTrendKg;
        w = saveWeight(db, { date, kg: weight.kg, macrauTrendKg: trend }, origin, mode);
      }
    }
    return { nutrition: n, weight: w };
  });
}

/**
 * The dashboard's day editor: nutrition and weigh-in saved together, so one
 * bad value saves nothing. `undefined` leaves a part alone, `null` deletes it.
 */
export function saveDay(db: Db, date: DateStr, parts: { nutrition?: unknown; weight?: unknown }, origin: Origin) {
  return transaction(db, () => {
    if (parts.nutrition === null) {
      if (getNutrition(db, date)) deleteNutrition(db, date);
    } else if (parts.nutrition !== undefined) {
      saveNutrition(db, { ...(parts.nutrition as object), date }, origin, 'replace');
    }
    if (parts.weight === null) {
      if (getWeight(db, date)) deleteWeight(db, date);
    } else if (parts.weight !== undefined) {
      saveWeight(db, { ...(parts.weight as object), date }, origin, 'replace');
    }
    return { nutrition: getNutrition(db, date), weight: getWeight(db, date) };
  });
}

export function deleteNutrition(db: Db, date: DateStr) {
  const r = db.prepare('DELETE FROM nutrition_days WHERE date = ?').run(date);
  if (r.changes === 0) throw new UserError(`No nutrition logged for ${date}.`, 404);
}

export function deleteWeight(db: Db, date: DateStr) {
  const r = db.prepare('DELETE FROM weights WHERE date = ?').run(date);
  if (r.changes === 0) throw new UserError(`No weigh-in on ${date}.`, 404);
}

// ------------------------------------------------------------------ exercises

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function slugify(name: string): string {
  return normalise(name).replace(/ /g, '-');
}

export function saveExercise(db: Db, raw: unknown): Exercise {
  const input: ExerciseInput = exerciseInput.parse(raw);
  const id = input.id ?? slugify(input.name);
  // Aliases must point at one exercise only, or the progress charts would split.
  for (const other of listExercises(db)) {
    if (other.id === id) continue;
    const taken = new Set([other.name, ...other.aliases].map(normalise));
    const clash = [input.name, ...input.aliases].find((n) => taken.has(normalise(n)));
    if (clash) throw new UserError(`"${clash}" already means ${other.name}.`);
  }
  db.prepare(
    `INSERT INTO exercises (id, name, kind, equipment, unilateral, aliases) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, equipment = excluded.equipment,
       unilateral = excluded.unilateral, aliases = excluded.aliases`,
  ).run(id, input.name, input.kind, input.equipment, input.unilateral ? 1 : 0, JSON.stringify(input.aliases));
  return listExercises(db).find((e) => e.id === id)!;
}

/** Find an exercise by id, name or alias, ignoring case and punctuation. */
export function resolveExercise(db: Db, query: string): Exercise {
  const exercises = listExercises(db);
  const q = normalise(query);
  const hit = exercises.find((e) => e.id === query || [e.name, ...e.aliases].some((n) => normalise(n) === q));
  if (hit) return hit;
  const words = q.split(' ').filter((w) => w.length > 2);
  const close = exercises
    .filter((e) => words.some((w) => normalise([e.name, ...e.aliases].join(' ')).includes(w)))
    .map((e) => e.name);
  throw new UserError(
    `No exercise called "${query}".` + (close.length ? ` Did you mean: ${close.join(', ')}?` : ' Add it first with the exercise command.'),
  );
}

// ------------------------------------------------------------------ program

export function setProgram(db: Db, raw: unknown): ProgramDay[] {
  const input: ProgramInput = programInput.parse(raw);
  const known = new Set(listExercises(db).map((e) => e.id));
  for (const day of input) {
    for (const ex of day.exercises) {
      if (!known.has(ex.exerciseId)) throw new UserError(`Day "${day.name}" uses an unknown exercise: ${ex.exerciseId}.`);
    }
  }
  return transaction(db, () => {
    const current = getProgram(db);
    const knownDays = new Set(current.map((d) => d.id));
    const keep = new Set<number>();
    for (const day of input) {
      if (day.id === undefined) continue;
      if (!knownDays.has(day.id)) throw new UserError(`No program day with id ${day.id}. Reload the program before saving.`);
      if (keep.has(day.id)) throw new UserError(`Program day ${day.id} appears more than once. Each day needs its own id.`);
      keep.add(day.id);
    }
    for (const d of current) if (!keep.has(d.id)) db.prepare('DELETE FROM program_days WHERE id = ?').run(d.id);
    input.forEach((day, i) => {
      let id = day.id;
      if (id !== undefined) {
        db.prepare('UPDATE program_days SET position = ?, name = ? WHERE id = ?').run(i + 1, day.name, id);
      } else {
        id = Number(db.prepare('INSERT INTO program_days (position, name) VALUES (?, ?)').run(i + 1, day.name).lastInsertRowid);
      }
      db.prepare('DELETE FROM program_exercises WHERE day_id = ?').run(id);
      day.exercises.forEach((ex, j) =>
        db.prepare('INSERT INTO program_exercises (day_id, position, exercise_id, sets) VALUES (?, ?, ?, ?)').run(id, j, ex.exerciseId, ex.sets),
      );
    });
    return getProgram(db);
  });
}

// ------------------------------------------------------------------ workouts

/**
 * Checks a workout's sets against its exercises and returns its program day's
 * name. `keepDay` is the day a workout was already logged under: it stays
 * valid even after that day is removed from the program.
 */
function checkWorkout(db: Db, input: WorkoutInput, keepDay?: { id: number | null; name: string | null }) {
  checkNotFuture(input.date);
  const exercises = new Map(listExercises(db).map((e) => [e.id, e]));
  for (const entry of input.exercises) {
    const ex = exercises.get(entry.exerciseId);
    if (!ex) throw new UserError(`Unknown exercise: ${entry.exerciseId}.`);
    if (ex.kind === 'weighted' && entry.sets.some((s) => s.kg == null)) {
      throw new UserError(`${ex.name} needs a weight on every set.`);
    }
    if (ex.kind === 'reps' && entry.sets.some((s) => s.kg != null && s.kg > 0)) {
      throw new UserError(`${ex.name} is tracked by reps only, so its sets shouldn't have a weight.`);
    }
  }
  if (input.programDayId == null) return null;
  if (keepDay && keepDay.id === input.programDayId) return keepDay.name;
  const day = getProgram(db).find((d) => d.id === input.programDayId);
  if (!day) throw new UserError(`No program day with id ${input.programDayId}.`);
  return day.name;
}

function writeSets(db: Db, workoutId: number, input: WorkoutInput) {
  db.prepare('DELETE FROM workout_sets WHERE workout_id = ?').run(workoutId);
  const ins = db.prepare('INSERT INTO workout_sets (workout_id, exercise_pos, exercise_id, set_pos, kg, reps) VALUES (?, ?, ?, ?, ?, ?)');
  input.exercises.forEach((entry, i) => entry.sets.forEach((s, j) => ins.run(workoutId, i, entry.exerciseId, j, s.kg, s.reps)));
}

/**
 * Log a workout. The same workout sent twice is stored once. A different
 * workout for the same date and program day is a clash (usually a corrected
 * resend): it's refused in create mode, and replaces the stored one in
 * replace mode, so a correction never becomes a second workout.
 */
export function addWorkout(db: Db, raw: unknown, origin: Origin, mode: SaveMode = 'create') {
  const input: WorkoutInput = workoutInput.parse(raw);
  const dayName = checkWorkout(db, input);
  return transaction(db, () => {
    const sameDay = listWorkouts(db).filter((w) => w.date === input.date && w.programDayId === input.programDayId);
    const sets = JSON.stringify(input.exercises.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets })));
    const dupe = sameDay.find((w) => JSON.stringify(w.exercises) === sets);
    if (dupe) return { outcome: 'unchanged' as SaveOutcome, workout: dupe };
    // Off-program sessions can genuinely happen twice in a day; program days can't.
    const clash = input.programDayId != null ? sameDay[0] : undefined;
    if (clash && mode === 'create') {
      throw new ConflictError(`${input.date} already has a ${dayName} workout with different sets (workout ${clash.id}).`, clash);
    }
    if (clash) {
      db.prepare('UPDATE workouts SET note = COALESCE(?, note), source = ?, source_image = COALESCE(?, source_image) WHERE id = ?').run(
        input.note,
        origin.source,
        origin.sourceImage ?? null,
        clash.id,
      );
      writeSets(db, clash.id, input);
      return { outcome: 'updated' as SaveOutcome, workout: getWorkout(db, clash.id)! };
    }
    const id = Number(
      db
        .prepare(
          'INSERT INTO workouts (date, program_day_id, program_day_name, note, source, source_image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(input.date, input.programDayId, dayName, input.note, origin.source, origin.sourceImage ?? null, now()).lastInsertRowid,
    );
    writeSets(db, id, input);
    return { outcome: 'created' as SaveOutcome, workout: getWorkout(db, id)! };
  });
}

export function updateWorkout(db: Db, id: number, raw: unknown) {
  const input: WorkoutInput = workoutInput.parse(raw);
  const existing = getWorkout(db, id);
  if (!existing) throw new UserError(`No workout with id ${id}.`, 404);
  // Keeps the name as it was when logged, unless the workout moves to a different day.
  const dayName = checkWorkout(db, input, { id: existing.programDayId, name: existing.programDayName });
  return transaction(db, () => {
    if (input.programDayId != null) {
      const clash = db.prepare('SELECT id FROM workouts WHERE date = ? AND program_day_id = ? AND id != ?').get(input.date, input.programDayId, id) as { id: number } | undefined;
      if (clash) throw new UserError(`${input.date} already has a ${dayName} workout (workout ${clash.id}). Open that workout to change it.`, 409);
    }
    db.prepare('UPDATE workouts SET date = ?, program_day_id = ?, program_day_name = ?, note = ? WHERE id = ?').run(
      input.date,
      input.programDayId,
      dayName,
      input.note,
      id,
    );
    writeSets(db, id, input);
    return getWorkout(db, id)!;
  });
}

export function deleteWorkout(db: Db, id: number) {
  const r = db.prepare('DELETE FROM workouts WHERE id = ?').run(id);
  if (r.changes === 0) throw new UserError(`No workout with id ${id}.`, 404);
}

/** Skip a program day for this cycle. A day already done or skipped this cycle can't be skipped. */
export function addSkip(db: Db, raw: unknown) {
  const input: SkipInput = skipInput.parse(raw);
  checkNotFuture(input.date);
  const program = getProgram(db);
  const day = program.find((d) => d.id === input.programDayId);
  if (!day) throw new UserError(`No program day with id ${input.programDayId}.`);
  const skips = (db.prepare('SELECT * FROM skips').all() as Row[]).map(
    (r): Skip => ({ id: Number(r.id), date: String(r.date), programDayId: Number(r.program_day_id), createdAt: String(r.created_at) }),
  );
  const state = cycleState(program, listWorkouts(db), skips);
  if (state.done.has(day.id)) throw new UserError(`Day ${day.position} is already done this cycle.`);
  if (state.skipped.has(day.id)) throw new UserError(`Day ${day.position} is already skipped this cycle.`);
  const id = Number(db.prepare('INSERT INTO skips (date, program_day_id, created_at) VALUES (?, ?, ?)').run(input.date, input.programDayId, now()).lastInsertRowid);
  return { id, ...input };
}

export function deleteSkip(db: Db, id: number) {
  const r = db.prepare('DELETE FROM skips WHERE id = ?').run(id);
  if (r.changes === 0) throw new UserError(`No skip with id ${id}.`, 404);
}

// ------------------------------------------------------------------ photos

export function addPhoto(db: Db, file: string, raw: unknown) {
  const meta: PhotoMetaInput = photoMetaInput.parse(raw);
  const stored = storeImage(file, 'photos', `${meta.date}-`);
  const existing = db.prepare('SELECT * FROM photos WHERE file = ?').get(stored) as Row | undefined;
  if (existing) return { outcome: 'unchanged' as SaveOutcome, photo: rowToPhoto(existing) };
  const size = imageSize(path.join(paths.files, stored));
  const id = Number(
    db
      .prepare('INSERT INTO photos (date, file, pose, note, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(meta.date, stored, meta.pose, meta.note, size?.width ?? null, size?.height ?? null, now()).lastInsertRowid,
  );
  return { outcome: 'created' as SaveOutcome, photo: rowToPhoto(db.prepare('SELECT * FROM photos WHERE id = ?').get(id) as Row) };
}

export function updatePhoto(db: Db, id: number, raw: unknown): Photo {
  const meta: PhotoMetaInput = photoMetaInput.parse(raw);
  const r = db.prepare('UPDATE photos SET date = ?, pose = ?, note = ? WHERE id = ?').run(meta.date, meta.pose, meta.note, id);
  if (r.changes === 0) throw new UserError(`No photo with id ${id}.`, 404);
  return rowToPhoto(db.prepare('SELECT * FROM photos WHERE id = ?').get(id) as Row);
}

export function deletePhoto(db: Db, id: number) {
  const row = db.prepare('SELECT file FROM photos WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new UserError(`No photo with id ${id}.`, 404);
  db.prepare('DELETE FROM photos WHERE id = ?').run(id);
  const still = db.prepare('SELECT 1 FROM photos WHERE file = ?').get(String(row.file));
  const file = path.join(paths.files, String(row.file));
  if (!still && existsSync(file)) unlinkSync(file);
}
