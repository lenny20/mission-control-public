// A shared exercise catalogue. Training programs belong to each installation.
// Aliases include names used by Strong.
// Only applied to an empty database; after that, the program is edited in the
// dashboard or by chat.

import type { ExerciseInput } from '../../shared/health/schemas.ts';
import { transaction, type Db } from '../db.ts';
import { getProgram, listExercises, saveExercise } from './repo.ts';

export const STARTING_EXERCISES: (ExerciseInput & { id: string })[] = [
  { id: 'bench-press', name: 'Bench press', kind: 'weighted', equipment: 'barbell', unilateral: false, aliases: ['bench', 'bp', 'barbell bench press', 'flat bench', 'bench press (barbell)'] },
  { id: 'incline-bench-smith', name: 'Incline bench press (Smith)', kind: 'weighted', equipment: 'smith', unilateral: false, aliases: ['incline smith', 'smith incline', 'incline bench smith', 'smith incline bench press', 'smith machine incline bench press', 'incline bench press (smith machine)'] },
  { id: 'dips', name: 'Dips', kind: 'bodyweight', equipment: 'bodyweight', unilateral: false, aliases: ['dip', 'chest dips', 'chest dip', 'tricep dips', 'parallel bar dips'] },
  { id: 'tricep-extensions', name: 'Tricep extensions', kind: 'weighted', equipment: 'cable', unilateral: false, aliases: ['tricep extension', 'triceps extension', 'overhead tricep extension', 'triceps extension (cable)', 'tricep extension (cable)'] },
  { id: 'lateral-raises', name: 'Lateral raises', kind: 'weighted', equipment: 'dumbbell', unilateral: false, aliases: ['lateral raise', 'side raises', 'side lateral raise', 'lat raises'] },
  { id: 'pull-ups', name: 'Pull-ups', kind: 'bodyweight', equipment: 'bodyweight', unilateral: false, aliases: ['pull ups', 'pullups', 'pull up', 'pullup'] },
  { id: 'dumbbell-curls', name: 'Dumbbell bicep curls', kind: 'weighted', equipment: 'dumbbell', unilateral: false, aliases: ['db curls', 'dumbbell curls', 'dumbbell curl', 'bicep curls', 'db bicep curls', 'bicep curl (dumbbell)', 'bicep curl'] },
  { id: 'concentration-curls', name: 'Concentration curls', kind: 'weighted', equipment: 'dumbbell', unilateral: true, aliases: ['concentration curl', 'concentration curl (dumbbell)'] },
  { id: 'lat-pulldown', name: 'Lat pulldown', kind: 'weighted', equipment: 'cable', unilateral: false, aliases: ['pulldown', 'lat pull down', 'lat pulldowns', 'pulldowns', 'lat pulldown (cable)'] },
  { id: 'face-pulls', name: 'Face pulls', kind: 'weighted', equipment: 'cable', unilateral: false, aliases: ['face pull'] },
  { id: 'goblet-squat', name: 'Goblet squat', kind: 'weighted', equipment: 'other', unilateral: false, aliases: ['goblet squats', 'goblet squat (kettlebell)', 'goblet squat (dumbbell)'] },
  { id: 'leg-extension', name: 'Leg extension', kind: 'weighted', equipment: 'machine', unilateral: false, aliases: ['leg extensions', 'leg extension machine', 'quad extension', 'leg extension (machine)'] },
  { id: 'leg-raises', name: 'Leg raises', kind: 'reps', equipment: 'bodyweight', unilateral: false, aliases: ['leg raise', 'hanging leg raises', 'hanging leg raise', 'lying leg raises'] },
  { id: 'cable-crunches', name: 'Cable crunches', kind: 'weighted', equipment: 'cable', unilateral: false, aliases: ['cable crunch', 'kneeling cable crunch'] },
  { id: 'incline-db-press', name: 'Incline dumbbell press', kind: 'weighted', equipment: 'dumbbell', unilateral: false, aliases: ['incline db press', 'incline dumbbell bench press', 'incline db'] },
  { id: 'cable-flyes', name: 'Cable flyes', kind: 'weighted', equipment: 'cable', unilateral: false, aliases: ['cable flys', 'cable fly', 'cable flies', 'cable crossover'] },
  { id: 'tricep-pushdown', name: 'Tricep pushdown', kind: 'weighted', equipment: 'cable', unilateral: false, aliases: ['tricep pushdowns', 'triceps pushdown', 'cable pushdown', 'rope pushdown', 'pushdowns'] },
  { id: 'barbell-curl', name: 'Barbell bicep curl', kind: 'weighted', equipment: 'barbell', unilateral: false, aliases: ['barbell curl', 'barbell curls', 'bb curl'] },
  { id: 'cable-curls', name: 'Cable curls', kind: 'weighted', equipment: 'cable', unilateral: false, aliases: ['cable curl', 'cable bicep curl'] },
  { id: 'seated-row', name: 'Seated row', kind: 'weighted', equipment: 'cable', unilateral: false, aliases: ['seated cable row', 'cable row', 'seated rows'] },
  { id: 'bulgarian-split-squats', name: 'Bulgarian split squats', kind: 'weighted', equipment: 'dumbbell', unilateral: true, aliases: ['bulgarian split squat', 'bss', 'split squats'] },
];

/** Returns true when it seeded, false when data already existed. */
export function seedIfEmpty(db: Db): boolean {
  if (listExercises(db).length > 0 || getProgram(db).length > 0) return false;
  transaction(db, () => {
    for (const ex of STARTING_EXERCISES) saveExercise(db, ex);
  });
  return true;
}
