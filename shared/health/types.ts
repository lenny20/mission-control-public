import type { DateStr } from '../dates.ts';
import type { EQUIPMENT, EXERCISE_KINDS, NutritionInput, POSES, Source } from './schemas.ts';

export type NutritionDay = NutritionInput & {
  source: Source;
  sourceImage: string | null;
  updatedAt: string;
};

export type WeightEntry = {
  date: DateStr;
  kg: number;
  macrauTrendKg: number | null;
  note: string | null;
  source: Source;
  sourceImage: string | null;
};

export type Exercise = {
  id: string;
  name: string;
  kind: (typeof EXERCISE_KINDS)[number];
  equipment: (typeof EQUIPMENT)[number];
  unilateral: boolean;
  aliases: string[];
};

export type ProgramDay = {
  id: number;
  position: number;
  name: string;
  exercises: { exerciseId: string; sets: number }[];
};

export type WorkoutSet = { kg: number | null; reps: number };

export type Workout = {
  id: number;
  date: DateStr;
  programDayId: number | null;
  /** The day's name when it was logged, so history reads right after the template changes. */
  programDayName: string | null;
  note: string | null;
  source: Source;
  sourceImage: string | null;
  createdAt: string;
  exercises: { exerciseId: string; sets: WorkoutSet[] }[];
};

export type Skip = { id: number; date: DateStr; programDayId: number; createdAt: string };

export type Photo = {
  id: number;
  date: DateStr;
  /** URL path the browser can load. */
  url: string;
  pose: (typeof POSES)[number] | null;
  note: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
};

export type HealthSnapshot = {
  today: DateStr;
  nutrition: NutritionDay[];
  weights: WeightEntry[];
  exercises: Exercise[];
  program: ProgramDay[];
  workouts: Workout[];
  skips: Skip[];
  photos: Photo[];
};
