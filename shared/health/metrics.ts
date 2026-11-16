// Everything the dashboard derives from raw health data. Pure functions, shared
// by the server, the logging command and the browser.

import { addDays, daysBetween, weekStart, type DateStr } from '../dates.ts';
import type { Exercise, NutritionDay, ProgramDay, Skip, WeightEntry, Workout, WorkoutSet } from './types.ts';

// ---------------------------------------------------------------- weight

export type TrendPoint = { date: DateStr; kg: number; trend: number };

/**
 * Smoothed weight trend: an exponential moving average that moves 10% of the
 * way toward each day's weigh-in. Gaps count as the days they span, so a
 * weigh-in after a long break pulls the trend further than one the next day.
 */
export function weightTrend(weights: readonly WeightEntry[], dailyRetention = 0.9): TrendPoint[] {
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const out: TrendPoint[] = [];
  let prev: TrendPoint | undefined;
  for (const w of sorted) {
    if (!prev) {
      prev = { date: w.date, kg: w.kg, trend: w.kg };
    } else {
      const gap = Math.max(1, daysBetween(prev.date, w.date));
      const pull = 1 - dailyRetention ** gap;
      prev = { date: w.date, kg: w.kg, trend: prev.trend + pull * (w.kg - prev.trend) };
    }
    out.push(prev);
  }
  return out;
}

/**
 * Bodyweight on a day: the nearest weigh-in either side (the earlier one on a
 * tie). Two days later is a better guess than three months before.
 */
export function bodyweightOn(date: DateStr, weights: readonly WeightEntry[]): number | null {
  let best: WeightEntry | null = null;
  let bestGap = Infinity;
  for (const w of weights) {
    const gap = Math.abs(daysBetween(w.date, date));
    if (gap < bestGap || (gap === bestGap && best && w.date < best.date)) {
      best = w;
      bestGap = gap;
    }
  }
  return best?.kg ?? null;
}

/**
 * Change in trend weight across roughly `days`, ending at the latest weigh-in.
 * Measured from the last weigh-in on or before the window start, and that
 * date is returned, so a long gap is never passed off as "30 days".
 */
export function trendChange(trend: readonly TrendPoint[], days: number): { kg: number; since: DateStr } | null {
  const last = trend.at(-1);
  if (!last) return null;
  const start = addDays(last.date, -days);
  let base: TrendPoint | undefined;
  for (const p of trend) if (p.date <= start) base = p;
  if (!base) return null;
  return { kg: last.trend - base.trend, since: base.date };
}

// ---------------------------------------------------------------- nutrition

/** Macrau's own sum: exercise burned is added back to the target. Positive means under. */
export function belowTarget(day: Pick<NutritionDay, 'eatenKcal' | 'targetKcal' | 'burnedKcal'>): number | null {
  if (day.targetKcal == null) return null;
  return day.targetKcal + day.burnedKcal - day.eatenKcal;
}

export function macroSplit(day: Pick<NutritionDay, 'proteinG' | 'carbsG' | 'fatG'>) {
  const p = (day.proteinG ?? 0) * 4;
  const c = (day.carbsG ?? 0) * 4;
  const f = (day.fatG ?? 0) * 9;
  const total = p + c + f;
  if (total === 0) return null;
  return { protein: p / total, carbs: c / total, fat: f / total };
}

/** Macrau's protein floor: hit at 90% of target (macroz/app/src/utils/dayEvaluation.ts FLOOR_GRACE). */
export const PROTEIN_HIT_RATIO = 0.9;

export function proteinHit(day: NutritionDay): boolean | null {
  if (day.proteinG == null || day.proteinTargetG == null || day.proteinTargetG === 0) return null;
  return day.proteinG >= day.proteinTargetG * PROTEIN_HIT_RATIO;
}

// ---------------------------------------------------------------- strength

/**
 * Estimated one-rep max, worked out the way the user's gym app (Strong) does, so
 * the two never disagree: Brzycki up to 10 reps, Epley with its 0.0333
 * constant past that. The two meet at 10 reps. Checked against all 28 weighted
 * sets in the 2, 3 and 6 Nov screenshots. 12.5 × 12 → 17 is the set that
 * rules out an exact 1/30, which would give 17.5 → 18.
 */
export function e1rm(load: number, reps: number): number | null {
  if (reps < 1 || load <= 0) return null;
  return reps <= 10 ? (load * 36) / (37 - reps) : load * (1 + 0.0333 * reps);
}

/**
 * Volume counts the weight on the bar or in each hand, so both dumbbells and
 * both sides of a single-side lift count, and bodyweight itself doesn't.
 * This reproduces the gym app's own totals (Push 2 Nov: 2,700 kg).
 */
export function volumeSides(exercise: Exercise): number {
  return exercise.equipment === 'dumbbell' || exercise.unilateral ? 2 : 1;
}

/** The load a set actually moved: bodyweight lifts add the day's bodyweight. */
export function setLoad(exercise: Exercise, set: WorkoutSet, bodyweight: number | null): number | null {
  switch (exercise.kind) {
    case 'weighted':
      return set.kg;
    case 'bodyweight':
      return bodyweight == null ? null : bodyweight + (set.kg ?? 0);
    case 'reps':
      return null;
  }
}

export type ScoredSet = WorkoutSet & { load: number | null; e1rm: number | null; pr: boolean };

export type Session = {
  workoutId: number;
  date: DateStr;
  sets: ScoredSet[];
  best: ScoredSet;
  bestE1rm: number | null;
  volume: number;
  totalReps: number;
};

function betterSet(a: ScoredSet, b: ScoredSet): ScoredSet {
  if ((a.e1rm ?? -1) !== (b.e1rm ?? -1)) return (a.e1rm ?? -1) > (b.e1rm ?? -1) ? a : b;
  if ((a.load ?? -1) !== (b.load ?? -1)) return (a.load ?? -1) > (b.load ?? -1) ? a : b;
  return a.reps >= b.reps ? a : b;
}

/**
 * Every session of one exercise, oldest first, with each set scored. A set is a
 * PR when its load beats every earlier set at the same rep count. The very
 * first session sets the baseline and has no PRs.
 */
export function exerciseSessions(
  exercise: Exercise,
  workouts: readonly Workout[],
  weights: readonly WeightEntry[],
): Session[] {
  const ordered = [...workouts].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const bestAtReps = new Map<number, number>();
  const sessions: Session[] = [];
  for (const w of ordered) {
    const entry = w.exercises.find((e) => e.exerciseId === exercise.id);
    if (!entry || entry.sets.length === 0) continue;
    const bw = exercise.kind === 'bodyweight' ? bodyweightOn(w.date, weights) : null;
    const isFirst = sessions.length === 0;
    const scored: ScoredSet[] = entry.sets.map((s) => {
      const load = setLoad(exercise, s, bw);
      return { ...s, load, e1rm: load == null ? null : e1rm(load, s.reps), pr: false };
    });
    // PRs are judged against history before this session, then history updates.
    for (const s of scored) {
      const metric = s.load ?? null;
      if (metric == null) continue;
      const prev = bestAtReps.get(s.reps);
      if (!isFirst && (prev == null || metric > prev)) s.pr = true;
    }
    for (const s of scored) {
      if (s.load == null) continue;
      bestAtReps.set(s.reps, Math.max(bestAtReps.get(s.reps) ?? 0, s.load));
    }
    // One trophy per rep count: on the set that set the new record (the
    // heaviest; the first of equals), not the first set that beat the old one.
    const top = new Map<number, ScoredSet>();
    for (const s of scored) {
      if (!s.pr) continue;
      const cur = top.get(s.reps);
      if (!cur || s.load! > cur.load!) top.set(s.reps, s);
    }
    for (const s of scored) if (s.pr && top.get(s.reps) !== s) s.pr = false;
    const best = scored.reduce(betterSet);
    const sides = volumeSides(exercise);
    sessions.push({
      workoutId: w.id,
      date: w.date,
      sets: scored,
      best,
      bestE1rm: scored.reduce<number | null>((m, s) => (s.e1rm != null && (m == null || s.e1rm > m) ? s.e1rm : m), null),
      volume: scored.reduce((sum, s) => sum + (s.kg ?? 0) * s.reps * sides, 0),
      totalReps: scored.reduce((sum, s) => sum + s.reps * (exercise.unilateral ? 2 : 1), 0),
    });
  }
  return sessions;
}

export type RepRecord = { reps: number; load: number; kg: number | null; date: DateStr };

/** The heaviest load ever moved at each rep count from 1 to 12. */
export function repRecords(sessions: readonly Session[]): RepRecord[] {
  const best = new Map<number, RepRecord>();
  for (const s of sessions) {
    for (const set of s.sets) {
      if (set.load == null || set.reps > 12) continue;
      const cur = best.get(set.reps);
      if (!cur || set.load > cur.load) best.set(set.reps, { reps: set.reps, load: set.load, kg: set.kg, date: s.date });
    }
  }
  return [...best.values()].sort((a, b) => a.reps - b.reps);
}

export type WeekVolume = { week: DateStr; volume: number; sets: number };

/** Volume (see volumeSides) per Monday-to-Sunday week. */
export function weeklyVolume(workouts: readonly Workout[], exercises: readonly Exercise[]): WeekVolume[] {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const weeks = new Map<DateStr, WeekVolume>();
  for (const w of workouts) {
    const wk = weekStart(w.date);
    const row = weeks.get(wk) ?? { week: wk, volume: 0, sets: 0 };
    for (const entry of w.exercises) {
      const ex = byId.get(entry.exerciseId);
      if (!ex) continue;
      const sides = volumeSides(ex);
      for (const s of entry.sets) {
        row.volume += (s.kg ?? 0) * s.reps * sides;
        row.sets += 1;
      }
    }
    weeks.set(wk, row);
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/** The most recent session of an exercise before `beforeDate` (or ever). */
export function lastTime(exerciseId: string, workouts: readonly Workout[], beforeDate?: DateStr) {
  let found: { date: DateStr; sets: WorkoutSet[] } | null = null;
  let foundId = -1;
  for (const w of workouts) {
    if (beforeDate && w.date >= beforeDate) continue;
    const entry = w.exercises.find((e) => e.exerciseId === exerciseId);
    if (!entry) continue;
    if (!found || w.date > found.date || (w.date === found.date && w.id > foundId)) {
      found = { date: w.date, sets: entry.sets };
      foundId = w.id;
    }
  }
  return found;
}

// ---------------------------------------------------------------- program

export type CycleState = {
  next: ProgramDay | null;
  /** Program day ids done or skipped in the current cycle. */
  done: Set<number>;
  skipped: Set<number>;
  /** 1-based count of cycles started, including the current one. */
  cycle: number;
};

/**
 * Which program day is next. Walks logged workouts and skips in order:
 * - each one marks its day as done (or skipped) in the current cycle;
 * - once every day in the program is done or skipped, a new cycle starts;
 * - logging a day that's already done this cycle means a new cycle has begun.
 * The next workout is the first day, in program order, not yet done or skipped.
 */
export function cycleState(program: readonly ProgramDay[], workouts: readonly Workout[], skips: readonly Skip[]): CycleState {
  const ids = new Set(program.map((d) => d.id));
  type Ev = { date: DateStr; at: string; dayId: number; kind: 'done' | 'skip' };
  const events: Ev[] = [
    ...workouts.flatMap((w) =>
      w.programDayId != null && ids.has(w.programDayId)
        ? [{ date: w.date, at: w.createdAt, dayId: w.programDayId, kind: 'done' as const }]
        : [],
    ),
    ...skips.flatMap((s) => (ids.has(s.programDayId) ? [{ date: s.date, at: s.createdAt, dayId: s.programDayId, kind: 'skip' as const }] : [])),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));

  let done = new Set<number>();
  let skipped = new Set<number>();
  let cycle = 1;
  const complete = () => [...ids].every((id) => done.has(id) || skipped.has(id));
  for (const ev of events) {
    if (done.has(ev.dayId) || skipped.has(ev.dayId)) {
      done = new Set();
      skipped = new Set();
      cycle += 1;
    }
    (ev.kind === 'done' ? done : skipped).add(ev.dayId);
    if (complete()) {
      done = new Set();
      skipped = new Set();
      cycle += 1;
    }
  }
  const ordered = [...program].sort((a, b) => a.position - b.position);
  const next = ordered.find((d) => !done.has(d.id) && !skipped.has(d.id)) ?? ordered[0] ?? null;
  return { next, done, skipped, cycle };
}

// ---------------------------------------------------------------- catch-up

export type CatchUp = {
  /** Recent days (not today) with no nutrition logged, oldest first. */
  missingNutrition: DateStr[];
  lastWorkoutDate: DateStr | null;
  daysSinceWorkout: number | null;
};

/**
 * What's missing lately, as plain information. Only looks back a week, and
 * never before the first day anything was logged.
 */
export function catchUp(today: DateStr, nutrition: readonly NutritionDay[], workouts: readonly Workout[]): CatchUp {
  const logged = new Set(nutrition.map((n) => n.date));
  const first = nutrition.reduce<DateStr | null>((m, n) => (m == null || n.date < m ? n.date : m), null);
  const missing: DateStr[] = [];
  if (first) {
    for (let i = 7; i >= 1; i--) {
      const d = addDays(today, -i);
      if (d < first) continue;
      if (!logged.has(d)) missing.push(d);
    }
  }
  const lastWorkoutDate = workouts.reduce<DateStr | null>((m, w) => (m == null || w.date > m ? w.date : m), null);
  return {
    missingNutrition: missing,
    lastWorkoutDate,
    daysSinceWorkout: lastWorkoutDate ? daysBetween(lastWorkoutDate, today) : null,
  };
}
