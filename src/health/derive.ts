import { useMemo } from 'react';
import { addDays, type DateStr } from '../../shared/dates.ts';
import {
  catchUp,
  cycleState,
  exerciseSessions,
  trendChange,
  weeklyVolume,
  weightTrend,
  type Session,
} from '../../shared/health/metrics.ts';
import type { Exercise, HealthSnapshot, NutritionDay, WeightEntry } from '../../shared/health/types.ts';

export type Derived = ReturnType<typeof derive>;

export function derive(data: HealthSnapshot) {
  const exById = new Map(data.exercises.map((e) => [e.id, e]));
  const trend = weightTrend(data.weights);
  const latestWeight: WeightEntry | null = data.weights.at(-1) ?? null;
  const latestTrend = trend.at(-1) ?? null;
  const nutritionByDate = new Map(data.nutrition.map((n) => [n.date, n]));
  const weightByDate = new Map(data.weights.map((w) => [w.date, w]));
  const latestNutrition: NutritionDay | null = data.nutrition.at(-1) ?? null;
  const cycle = cycleState(data.program, data.workouts, data.skips);

  const sessions = new Map<string, Session[]>();
  for (const ex of data.exercises) {
    const s = exerciseSessions(ex, data.workouts, data.weights);
    if (s.length) sessions.set(ex.id, s);
  }

  // Lifts in the order they first appear in the program, then anything else trained.
  const programOrder: Exercise[] = [];
  for (const day of [...data.program].sort((a, b) => a.position - b.position)) {
    for (const e of day.exercises) {
      const ex = exById.get(e.exerciseId);
      if (ex && !programOrder.includes(ex)) programOrder.push(ex);
    }
  }
  for (const id of sessions.keys()) {
    const ex = exById.get(id)!;
    if (!programOrder.includes(ex)) programOrder.push(ex);
  }

  const workoutDates = new Set(data.workouts.map((w) => w.date));
  const photoDates = new Set(data.photos.map((p) => p.date));

  return {
    exById,
    trend,
    latestWeight,
    latestTrend,
    change: {
      d30: trendChange(trend, 30),
      d90: trendChange(trend, 90),
      year: trendChange(trend, 365),
    },
    nutritionByDate,
    weightByDate,
    latestNutrition,
    cycle,
    sessions,
    lifts: programOrder,
    volume: weeklyVolume(data.workouts, data.exercises),
    catchUp: catchUp(data.today, data.nutrition, data.workouts),
    workoutDates,
    photoDates,
  };
}

export function useDerived(data: HealthSnapshot): Derived {
  return useMemo(() => derive(data), [data]);
}

/** The last `n` calendar days ending today, oldest first. */
export function lastDays(today: DateStr, n: number): DateStr[] {
  return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
}
