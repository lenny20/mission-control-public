// The checks every Work write goes through, from chat or the dashboard.

import { z } from 'zod';
import { dateStr } from '../health/schemas.ts';

export const BOARDS = ['film', 'software'] as const;
export type Board = (typeof BOARDS)[number];

export const COLUMNS = {
  film: ['ideas', 'developing', 'writing', 'out', 'in-play', 'shelved'],
  software: ['backlog', 'next', 'doing', 'done'],
} as const satisfies Record<Board, readonly string[]>;
export type Column = (typeof COLUMNS)[Board][number];

export const COLUMN_LABELS: Record<Column, string> = {
  ideas: 'Ideas',
  developing: 'Developing',
  writing: 'Writing',
  out: 'Out',
  'in-play': 'In Play',
  shelved: 'Shelved',
  backlog: 'Backlog',
  next: 'Next',
  doing: 'Doing',
  done: 'Done',
};

export const BOARD_LABELS: Record<Board, string> = { film: 'Film & TV', software: 'Software' };

export const FORMATS = ['feature', 'pilot', 'series', 'short'] as const;
export const KINDS = ['feature', 'bug'] as const;
export const PROJECT_STATUSES = ['active', 'paused'] as const;

/** The most cards that can be in focus at once, across both boards. */
export const MAX_FOCUS = 3;
/** Done cards leave the board this many days after they're done. */
export const DONE_CLEARS_AFTER = 14;
/** Cards in active columns unchanged this long are listed in the weekly review. */
export const UNTOUCHED_DAYS = 14;
/** A submission's follow-up date when none is given: six weeks after sending. */
export const FOLLOW_UP_DAYS = 42;

export function isColumn(board: Board, column: string): column is Column {
  return (COLUMNS[board] as readonly string[]).includes(column);
}

// Blank text is stored as null.
const text = (max: number, what: string) =>
  z
    .string()
    .max(max, `Keep the ${what} under ${max.toLocaleString('en-AU')} characters.`)
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null));

const title = z.string({ error: 'Give the card a title.' }).trim().min(1, 'Give the card a title.').max(300, 'Keep the title under 300 characters.');

const link = z.object({
  label: text(120, 'link label').default(null),
  url: z.string().trim().max(2_000).pipe(z.url({ protocol: /^https?$/, error: 'Links need to be full web addresses, starting with https://.' })),
});

/**
 * Every editable card field. Film fields are null on software cards and the
 * other way round; the repo checks which apply.
 */
const cardFields = {
  title,
  notes: text(20_000, 'notes'),
  links: z.array(link).max(30, 'Keep it to 30 links.'),
  due: dateStr.nullable(),
  focus: z.boolean(),
  // Film & TV
  logline: text(1_000, 'logline'),
  format: z.enum(FORMATS, { error: 'The format is feature, pilot, series or short.' }).nullable(),
  draft: text(120, 'draft name'),
  draftDate: dateStr.nullable(),
  nextAction: text(300, 'next action'),
  projectId: z.number().int().positive().nullable(),
  // Software
  kind: z.enum(KINDS, { error: 'A software card is a feature or a bug.' }),
};

export const cardInput = z.object({
  board: z.enum(BOARDS, { error: 'The board is film or software.' }),
  /** Defaults to the board's first column. */
  column: z.string().optional(),
  /** Add to the top of the column instead of the bottom. */
  top: z.boolean().default(false),
  title: cardFields.title,
  notes: cardFields.notes.default(null),
  links: cardFields.links.default([]),
  due: cardFields.due.default(null),
  focus: cardFields.focus.default(false),
  logline: cardFields.logline.default(null),
  format: cardFields.format.default(null),
  draft: cardFields.draft.default(null),
  draftDate: cardFields.draftDate.default(null),
  nextAction: cardFields.nextAction.default(null),
  projectId: cardFields.projectId.default(null),
  kind: cardFields.kind.default('feature'),
});
export type CardInput = z.infer<typeof cardInput>;

/** Only the fields being changed; anything left out stays as it is. */
export const cardPatch = z.object(cardFields).partial().strict();
export type CardPatch = z.infer<typeof cardPatch>;

export const moveInput = z.object({
  column: z.string(),
  /** Put it just above this card; null or left out puts it at the bottom. */
  before: z.number().int().positive().nullable().default(null),
});
export type MoveInput = z.infer<typeof moveInput>;

const projectFields = {
  name: z.string({ error: 'Give the project a name.' }).trim().min(1, 'Give the project a name.').max(80, 'Keep the name under 80 characters.'),
  /** The category sets the project's colour; none leaves it grey. */
  categoryId: z.number().int().positive().nullable(),
  status: z.enum(PROJECT_STATUSES, { error: 'A project is active or paused.' }),
};
export const projectInput = z.object({
  name: projectFields.name,
  categoryId: projectFields.categoryId.default(null),
  status: projectFields.status.default('active'),
});
/** No defaults: a field left out stays as it is. */
export const projectPatch = z.object(projectFields).partial().strict();
export type ProjectInput = z.infer<typeof projectInput>;
export type ProjectPatch = z.infer<typeof projectPatch>;

const categoryFields = {
  name: z.string({ error: 'Give the category a name.' }).trim().min(1, 'Give the category a name.').max(40, 'Keep the name under 40 characters.'),
  colour: z.string().regex(/^#[0-9a-f]{6}$/i, 'Colours are written like #5b8def.'),
};
export const categoryInput = z.object({
  name: categoryFields.name,
  /** Defaults to the next unused colour. */
  colour: categoryFields.colour.nullable().default(null),
});
export const categoryPatch = z.object(categoryFields).partial().strict();

const submissionFields = {
  recipient: z.string({ error: 'Say who it went to.' }).trim().min(1, 'Say who it went to.').max(200, 'Keep the name under 200 characters.'),
  sentOn: dateStr,
  followUpOn: dateStr.nullable(),
  response: text(500, 'response'),
  respondedOn: dateStr.nullable(),
  notes: text(4_000, 'notes'),
};

export const submissionInput = z.object({
  recipient: submissionFields.recipient,
  /** Defaults to today. */
  sentOn: submissionFields.sentOn.optional(),
  /** Defaults to six weeks after sending. */
  followUpOn: submissionFields.followUpOn.optional(),
  response: submissionFields.response.default(null),
  respondedOn: submissionFields.respondedOn.default(null),
  notes: submissionFields.notes.default(null),
});
export type SubmissionInput = z.infer<typeof submissionInput>;
export const submissionPatch = z.object(submissionFields).partial().strict();
export type SubmissionPatch = z.infer<typeof submissionPatch>;

export const focusInput = z.array(z.number().int().positive()).max(MAX_FOCUS, `Pick ${MAX_FOCUS} cards at most.`);

/** Distinct, readable on the dark background, offered for categories and assigned in order to new ones. */
export const CATEGORY_COLOURS = ['#5b8def', '#e879a8', '#34d399', '#fbbf24', '#a78bfa', '#f97316', '#22d3ee', '#f87171'];
/** A project with no category. */
export const UNCATEGORISED = '#8b8b95';
