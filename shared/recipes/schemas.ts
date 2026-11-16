import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).nullable().transform((v) => v || null);
const minutes = z.number().int('Times are whole minutes.').min(0).max(10080).nullable();
const fields = {
  title: z.string().trim().min(1, 'Give the recipe a name.').max(200).transform((v) => v.replace(/\s+/g, ' ')),
  description: optionalText(2000),
  servings: z.number().positive('Servings must be more than zero.').max(1000).nullable(),
  prepMinutes: minutes,
  cookMinutes: minutes,
  ingredients: z.array(z.string().trim().min(1, 'Ingredients cannot be blank.').max(2000)).min(1, 'Add at least one ingredient.').max(200),
  steps: z.array(z.string().trim().min(1, 'Steps cannot be blank.').max(10000)).min(1, 'Add at least one step.').max(100),
  tags: z.array(z.string().trim().min(1).max(40).transform((v) => v.toLowerCase())).max(20).transform((v) => [...new Set(v)]),
  notes: optionalText(20000),
  sourceUrl: z.string().trim().max(2000).url('Use a full source link, starting with https:// or http://.')
    .refine((v) => /^https?:\/\//i.test(v), 'Source links must start with https:// or http://.').nullable(),
};

// The logging command and dashboard both save through these checks.
export const recipeInput = z.object({
  ...fields,
  description: fields.description.default(null),
  servings: fields.servings.default(null),
  prepMinutes: fields.prepMinutes.default(null),
  cookMinutes: fields.cookMinutes.default(null),
  tags: fields.tags.default([]),
  notes: fields.notes.default(null),
  sourceUrl: fields.sourceUrl.default(null),
  favourite: z.boolean().optional(),
}).strict();

export const recipePatch = z.object({
  ...fields,
  favourite: z.boolean(),
  baseRevision: z.number().int().positive(),
}).partial().strict();

export type RecipeInput = z.output<typeof recipeInput>;
export const recipeTitleKey = (title: string) => title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
