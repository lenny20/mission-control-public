// The one set of checks every health write goes through, whether it comes from
// the logging command (chat) or the dashboard's edit screens.

import { z } from 'zod';
import { isDateStr } from '../dates.ts';

export const dateStr = z.string().refine(isDateStr, { message: 'Dates are written YYYY-MM-DD and must be a real day.' });

// Messages are shown to the user as-is, so they say what's wrong in plain words.
const num = (what: string) => z.number({ error: `${what} needs to be a number.` });
const kcal = num('Calories').min(0, "Calories can't be negative.").max(15_000, 'Calories over 15,000 look like a typo.');
const grams = num('Grams').min(0, "Grams can't be negative.").max(1_500, 'Over 1,500 g looks like a typo.');
const bodyKg = num('Weight').min(30, 'Weight should be in kg, between 30 and 300.').max(300, 'Weight should be in kg, between 30 and 300.');

export const SOURCES = ['chat', 'dashboard', 'import'] as const;
export const source = z.enum(SOURCES);
export type Source = z.infer<typeof source>;

export const nutritionInput = z.object({
  date: dateStr,
  eatenKcal: kcal,
  targetKcal: kcal.nullable().default(null),
  burnedKcal: kcal.default(0),
  proteinG: grams.nullable().default(null),
  proteinTargetG: grams.nullable().default(null),
  carbsG: grams.nullable().default(null),
  carbsTargetG: grams.nullable().default(null),
  fatG: grams.nullable().default(null),
  fatTargetG: grams.nullable().default(null),
  note: z.string().max(2_000).nullable().default(null),
});
export type NutritionInput = z.infer<typeof nutritionInput>;

export const weightInput = z.object({
  date: dateStr,
  kg: bodyKg,
  macrauTrendKg: bodyKg.nullable().default(null),
  note: z.string().max(2_000).nullable().default(null),
});
export type WeightInput = z.infer<typeof weightInput>;

/** A Macrau daily recap: one day's nutrition plus the weigh-in it shows. */
export const recapInput = nutritionInput.extend({
  weight: z
    .object({
      kg: bodyKg,
      /** The date label under the weight, when the recap shows one (an earlier weigh-in). */
      labelledDate: dateStr.nullable().default(null),
      macrauTrendKg: bodyKg.nullable().default(null),
    })
    .nullable()
    .default(null),
});
export type RecapInput = z.infer<typeof recapInput>;

export const EXERCISE_KINDS = ['weighted', 'bodyweight', 'reps'] as const;
export const EQUIPMENT = ['barbell', 'dumbbell', 'smith', 'machine', 'cable', 'bodyweight', 'other'] as const;

export const exerciseInput = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'ids are lowercase words joined by hyphens')
    .max(60)
    .optional(),
  name: z.string().trim().min(1).max(80),
  /** weighted: load is the weight lifted. bodyweight: load is bodyweight plus added weight. reps: reps only. */
  kind: z.enum(EXERCISE_KINDS),
  equipment: z.enum(EQUIPMENT),
  /** Reps are recorded per side. */
  unilateral: z.boolean().default(false),
  aliases: z.array(z.string().trim().min(1).max(80)).default([]),
});
export type ExerciseInput = z.infer<typeof exerciseInput>;

export const setInput = z.object({
  /** Weight lifted; per dumbbell for dumbbells; added weight for bodyweight lifts; null for reps-only. */
  kg: num('Set weight').min(0, "A set's weight can't be negative.").max(500, 'Over 500 kg looks like a typo.').nullable().default(null),
  reps: num('Reps').int('Reps are whole numbers.').min(1, 'Reps start at 1. Leave a set blank to skip it.').max(200, 'Over 200 reps looks like a typo.'),
});
export type SetInput = z.infer<typeof setInput>;

export const workoutInput = z.object({
  date: dateStr,
  programDayId: z.number().int().positive().nullable().default(null),
  note: z.string().max(4_000).nullable().default(null),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string().min(1),
        sets: z.array(setInput).min(1).max(30),
      }),
    )
    .min(1)
    .max(40),
});
export type WorkoutInput = z.infer<typeof workoutInput>;

export const programDayInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(80),
  exercises: z
    .array(z.object({ exerciseId: z.string().min(1), sets: z.number().int().min(1).max(20).default(3) }))
    .max(30),
});
export const programInput = z.array(programDayInput).min(1).max(14);
export type ProgramInput = z.infer<typeof programInput>;

export const POSES = ['front', 'side', 'back'] as const;
export const photoMetaInput = z.object({
  date: dateStr,
  pose: z.enum(POSES).nullable().default(null),
  note: z.string().max(2_000).nullable().default(null),
});
export type PhotoMetaInput = z.infer<typeof photoMetaInput>;

export const skipInput = z.object({
  date: dateStr,
  programDayId: z.number().int().positive(),
});
export type SkipInput = z.infer<typeof skipInput>;
