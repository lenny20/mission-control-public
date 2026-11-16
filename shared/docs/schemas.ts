// The checks every Ideas, Notes and Links write goes through, from chat or the dashboard.

import { z } from 'zod';
import { BOARDS } from '../work/schemas.ts';

const text = (max: number, what: string) =>
  z
    .string()
    .max(max, `Keep the ${what} under ${max.toLocaleString('en-AU')} characters.`)
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null));
/** One line of text, for names that land in a note's settings block. */
const oneLine = (max: number, what: string) => text(max, what).refine((v) => v == null || !/[\u0000-\u001f]/.test(v), { message: `The ${what} has to be one line.` });

export const ideaInput = z.object({
  text: z.string({ error: 'Write the idea down first.' }).trim().min(1, 'Write the idea down first.').max(10_000, 'Keep an idea under 10,000 characters. A longer one is a note.'),
});

export const ideaSort = z.discriminatedUnion(
  'to',
  [
    z.object({ to: z.literal('card'), board: z.enum(BOARDS), projectId: z.number().int().positive().nullable().default(null) }),
    z.object({ to: z.literal('note'), project: oneLine(200, 'project').default(null) }),
    z.object({ to: z.literal('watch') }),
    z.object({ to: z.literal('archive') }),
    /** Back to the inbox, undoing an archive. */
    z.object({ to: z.literal('inbox') }),
  ],
  { error: 'Sort an idea to a card, a note, the watchlist or the archive.' },
);
export type IdeaSort = z.infer<typeof ideaSort>;

const url = z.string({ error: 'Give the link a web address.' }).trim().max(2_000).pipe(z.url({ protocol: /^https?$/, error: 'Links need to be full web addresses, starting with https://.' }));

export const linkInput = z.object({
  url,
  title: text(300, 'title').default(null),
  note: text(4_000, 'note').default(null),
  project: text(200, 'project').default(null),
});
export const linkPatch = z.object({ url, title: text(300, 'title'), note: text(4_000, 'note'), project: text(200, 'project') }).partial().strict();

const noteTitle = z
  .string({ error: 'Give the note a title.' })
  .trim()
  .min(1, 'Give the note a title.')
  .max(120, 'Keep the title under 120 characters.')
  .refine((t) => !/[/\\:*?"<>|\u0000-\u001f]/.test(t) && !t.startsWith('.'), { message: 'A title can\'t contain / \\ : * ? " < > | or start with a dot, because it becomes the file name.' });

export const noteInput = z.object({
  title: noteTitle,
  body: z.string().max(1_000_000, 'That note is too long.').default(''),
  project: oneLine(200, 'project').default(null),
});
export const notePatch = z
  .object({
    title: noteTitle,
    body: z.string().max(1_000_000, 'That note is too long.'),
    project: oneLine(200, 'project'),
    /** The modified time the editor loaded; a different one on disk means it changed elsewhere. */
    baseModified: z.string().optional(),
  })
  .partial()
  .strict();

export const docsSettings = z.object({
  roots: z.array(z.string().trim().min(1).max(500)).max(30),
  exclude: z.array(z.string().trim().min(1).max(200)).max(200),
});
