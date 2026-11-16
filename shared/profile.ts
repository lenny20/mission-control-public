import { z } from 'zod';

export const AREAS = ['calendar', 'work', 'notes', 'money', 'watch', 'health', 'recipes'] as const;
export const profileSchema = z.object({
  displayName: z.string().trim().max(80).refine((s) => !/[\u0000-\u001f]/.test(s), 'Use a single line for your name.').default(''),
  watchRegion: z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter country code, such as AU or US.').default('AU'),
  sidebarAreas: z.array(z.enum(AREAS)).max(AREAS.length).transform((xs) => [...new Set(xs)]).default([...AREAS]),
  setupComplete: z.boolean().default(false),
}).strict();
export type Profile = z.infer<typeof profileSchema>;
// Patches must not apply creation defaults to omitted fields.
export const profilePatch = z.object({
  displayName: profileSchema.shape.displayName.removeDefault(),
  watchRegion: profileSchema.shape.watchRegion.removeDefault(),
  sidebarAreas: profileSchema.shape.sidebarAreas.removeDefault(),
  setupComplete: profileSchema.shape.setupComplete.removeDefault(),
}).partial().strict();
