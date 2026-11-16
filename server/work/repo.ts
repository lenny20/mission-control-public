// The one save path for the Work boards. The logging command and the HTTP API
// both call these functions, so every write passes the same checks.

import { addDays, type DateStr } from '../../shared/dates.ts';
import type { CalEvent } from '../../shared/calendar/types.ts';
import {
  cardInput,
  cardPatch,
  COLUMN_LABELS,
  COLUMNS,
  focusInput,
  FOLLOW_UP_DAYS,
  isColumn,
  MAX_FOCUS,
  moveInput,
  CATEGORY_COLOURS,
  categoryInput,
  categoryPatch,
  UNCATEGORISED,
  projectInput,
  projectPatch,
  submissionInput,
  submissionPatch,
  type Board,
  type CardPatch,
} from '../../shared/work/schemas.ts';
import type { Card, Category, Project, Submission, WorkSnapshot } from '../../shared/work/types.ts';
import { transaction, type Db } from '../db.ts';
import { UserError } from '../errors.ts';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const now = () => new Date().toISOString();

// ------------------------------------------------------------------ reads

function rowToCard(r: Row): Card {
  return {
    id: Number(r.id),
    board: r.board as Board,
    column: r.col as Card['column'],
    position: Number(r.position),
    title: String(r.title),
    notes: str(r.notes),
    links: JSON.parse(String(r.links)) as Card['links'],
    due: str(r.due),
    focus: Boolean(r.focus),
    logline: str(r.logline),
    format: str(r.format) as Card['format'],
    draft: str(r.draft),
    draftDate: str(r.draft_date),
    nextAction: str(r.next_action),
    projectId: r.project_id == null ? null : Number(r.project_id),
    kind: r.kind as Card['kind'],
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    doneOn: str(r.done_on),
  };
}

/** Rows from PROJECTS, which brings the category's colour along. */
const rowToProject = (r: Row): Project => ({
  id: Number(r.id),
  name: String(r.name),
  categoryId: r.category_id == null ? null : Number(r.category_id),
  colour: r.category_colour == null ? UNCATEGORISED : String(r.category_colour),
  status: r.status as Project['status'],
  position: Number(r.position),
});
const PROJECTS = 'SELECT p.*, c.colour AS category_colour FROM work_projects p LEFT JOIN work_categories c ON c.id = p.category_id';

const rowToCategory = (r: Row): Category => ({ id: Number(r.id), name: String(r.name), colour: String(r.colour), position: Number(r.position) });

const rowToSubmission = (r: Row): Submission => ({
  id: Number(r.id),
  cardId: Number(r.card_id),
  recipient: String(r.recipient),
  sentOn: String(r.sent_on),
  followUpOn: str(r.follow_up_on),
  response: str(r.response),
  respondedOn: str(r.responded_on),
  notes: str(r.notes),
});

export function listCards(db: Db): Card[] {
  return (db.prepare('SELECT * FROM cards ORDER BY board, col, position, id').all() as Row[]).map(rowToCard);
}

export function getCard(db: Db, id: number): Card {
  const r = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new UserError(`There's no card ${id}.`, 404);
  return rowToCard(r);
}

export function listProjects(db: Db): Project[] {
  return (db.prepare(`${PROJECTS} ORDER BY p.position, p.id`).all() as Row[]).map(rowToProject);
}

function getProject(db: Db, id: number): Project {
  const r = db.prepare(`${PROJECTS} WHERE p.id = ?`).get(id) as Row | undefined;
  if (!r) throw new UserError(`There's no project ${id}.`, 404);
  return rowToProject(r);
}

/** A project by id or name, for chat. Unknown names list the ones that exist. */
export function resolveProject(db: Db, key: string | number): Project {
  if (typeof key === 'number' || /^\d+$/.test(key)) return getProject(db, Number(key));
  const r = db.prepare(`${PROJECTS} WHERE p.name = ? COLLATE NOCASE`).get(key.trim()) as Row | undefined;
  if (r) return rowToProject(r);
  const names = listProjects(db).map((p) => p.name);
  throw new UserError(`No project called "${key}". ${names.length ? `Projects: ${names.join(', ')}.` : 'There are no projects yet.'} Add one with the project command.`);
}

export function listSubmissions(db: Db, cardId?: number): Submission[] {
  const rows = cardId == null ? db.prepare('SELECT * FROM submissions ORDER BY sent_on, id').all() : db.prepare('SELECT * FROM submissions WHERE card_id = ? ORDER BY sent_on, id').all(cardId);
  return (rows as Row[]).map(rowToSubmission);
}

function getSubmission(db: Db, id: number): Submission {
  const r = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new UserError(`There's no submission ${id}.`, 404);
  return rowToSubmission(r);
}

export function snapshot(db: Db, today: DateStr): WorkSnapshot {
  return { today, cards: listCards(db), projects: listProjects(db), categories: listCategories(db), submissions: listSubmissions(db) };
}

/** Real deadlines, as all-day calendar entries that open the card. */
export function deadlines(db: Db, from: DateStr, to: DateStr): CalEvent[] {
  const rows = db.prepare("SELECT * FROM cards WHERE due IS NOT NULL AND due >= ? AND due < ? AND col NOT IN ('done', 'shelved')").all(from, to) as Row[];
  return rows.map(rowToCard).map((c) => ({
    id: -c.id,
    title: `Due: ${c.title}`,
    allDay: true,
    start: c.due!,
    end: addDays(c.due!, 1),
    location: null,
    notes: null,
    calendarId: null,
    htmlLink: `#/work/${c.board}/${c.id}`,
    meetLink: null,
    recurring: false,
    hasGuests: false,
    source: 'work',
    updatedAt: c.updatedAt,
  }));
}

// ------------------------------------------------------------------ cards

const FILM_ONLY = ['logline', 'format', 'draft', 'draftDate', 'nextAction'] as const;
const FIELD_NAMES: Record<string, string> = { logline: 'A logline', format: 'A format', draft: 'A draft', draftDate: 'A draft date', nextAction: 'A next action' };

/** Film fields belong on film cards. A project can hold cards on either board. */
function checkBoardFields(db: Db, board: Board, fields: Partial<CardPatch>) {
  if (board === 'software') {
    for (const f of FILM_ONLY) if (fields[f] != null) throw new UserError(`${FIELD_NAMES[f]} is for Film & TV cards, not software ones.`);
  }
  if (fields.projectId != null) getProject(db, fields.projectId);
}

function checkFocus(db: Db, id: number | null) {
  const n = (db.prepare('SELECT count(*) AS n FROM cards WHERE focus = 1 AND id IS NOT ?').get(id) as { n: number }).n;
  if (n >= MAX_FOCUS) throw new UserError(`${MAX_FOCUS} cards are already in focus. Take one out of focus first.`);
}

function checkColumn(board: Board, column: string) {
  if (!isColumn(board, column)) {
    throw new UserError(`"${column}" isn't a column on that board. Columns: ${COLUMNS[board].join(', ')}.`);
  }
}

/**
 * Renumber a column 0, 1, 2... With `id`, that card goes just above `before`,
 * or to the bottom when `before` is null or no longer in the column.
 */
function place(db: Db, board: Board, column: string, id: number | null = null, before: number | null = null) {
  const ids = (db.prepare('SELECT id FROM cards WHERE board = ? AND col = ? AND id IS NOT ? ORDER BY position, id').all(board, column, id) as { id: number }[]).map((r) => r.id);
  if (id != null) {
    const at = before == null ? -1 : ids.indexOf(before);
    ids.splice(at === -1 ? ids.length : at, 0, id);
  }
  const set = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
  ids.forEach((cardId, i) => set.run(i, cardId));
}

/** Fill a card's due-date, link and text fields into SQL values. */
const dbValues = (c: Omit<Card, 'id' | 'board' | 'column' | 'position' | 'createdAt' | 'updatedAt' | 'doneOn'>) => ({
  title: c.title,
  notes: c.notes,
  links: JSON.stringify(c.links),
  due: c.due,
  focus: c.focus ? 1 : 0,
  logline: c.logline,
  format: c.format,
  draft: c.draft,
  draft_date: c.draftDate,
  next_action: c.nextAction,
  project_id: c.projectId,
  kind: c.kind,
});

export function createCard(db: Db, raw: unknown, source: 'chat' | 'dashboard', today: DateStr): Card {
  const input = cardInput.parse(raw);
  const column = input.column ?? COLUMNS[input.board][0];
  checkColumn(input.board, column);
  checkBoardFields(db, input.board, input);
  return transaction(db, () => {
    const focus = input.focus && column !== 'done';
    if (focus) checkFocus(db, null);
    const v = dbValues({ ...input, focus });
    const at = now();
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO cards (board, col, position, title, notes, links, due, focus, logline, format, draft, draft_date, next_action, project_id, kind, source, created_at, updated_at, done_on)
         VALUES (?, ?, 1e9, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.board, column, v.title, v.notes, v.links, v.due, v.focus, v.logline, v.format, v.draft, v.draft_date, v.next_action, v.project_id, v.kind, source, at, at, column === 'done' ? today : null);
    const id = Number(lastInsertRowid);
    const first = input.top ? (db.prepare('SELECT id FROM cards WHERE board = ? AND col = ? AND id != ? ORDER BY position, id LIMIT 1').get(input.board, column, id) as { id: number } | undefined) : undefined;
    place(db, input.board, column, id, first?.id ?? null);
    return getCard(db, id);
  });
}

export function updateCard(db: Db, id: number, raw: unknown): Card {
  const patch = cardPatch.parse(raw);
  return transaction(db, () => {
    const card = getCard(db, id);
    checkBoardFields(db, card.board, patch);
    if (patch.focus && !card.focus) {
      if (card.column === 'done') throw new UserError("That card is done, so it can't be in focus.");
      checkFocus(db, id);
    }
    const v = dbValues({ ...card, ...patch });
    db.prepare(
      `UPDATE cards SET title = ?, notes = ?, links = ?, due = ?, focus = ?, logline = ?, format = ?, draft = ?, draft_date = ?, next_action = ?, project_id = ?, kind = ?, updated_at = ? WHERE id = ?`,
    ).run(v.title, v.notes, v.links, v.due, v.focus, v.logline, v.format, v.draft, v.draft_date, v.next_action, v.project_id, v.kind, now(), id);
    return getCard(db, id);
  });
}

/** Move a card to a column, above another card or at the bottom. Done is stamped, and leaves focus. */
export function moveCard(db: Db, id: number, raw: unknown, today: DateStr): Card {
  const move = moveInput.parse(raw);
  return transaction(db, () => {
    const card = getCard(db, id);
    checkColumn(card.board, move.column);
    const doneOn = move.column === 'done' ? (card.column === 'done' ? card.doneOn : today) : null;
    const focus = move.column === 'done' ? 0 : card.focus ? 1 : 0;
    const changed = card.column !== move.column;
    db.prepare('UPDATE cards SET col = ?, done_on = ?, focus = ? WHERE id = ?').run(move.column, doneOn, focus, id);
    place(db, card.board, move.column, id, move.before);
    if (changed) place(db, card.board, card.column);
    // Re-prioritising within a column is a move too, so it counts as touching the card.
    const after = getCard(db, id);
    if (changed || after.position !== card.position) db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now(), id);
    return getCard(db, id);
  });
}

export function deleteCard(db: Db, id: number): Card {
  return transaction(db, () => {
    const card = getCard(db, id);
    db.prepare('DELETE FROM cards WHERE id = ?').run(id);
    place(db, card.board, card.column);
    return card;
  });
}

/** Exactly these cards in focus, in any order. */
export function setFocus(db: Db, raw: unknown): Card[] {
  const ids = [...new Set(focusInput.parse(raw))];
  return transaction(db, () => {
    for (const id of ids) {
      if (getCard(db, id).column === 'done') throw new UserError(`Card ${id} is done, so it can't be in focus.`);
    }
    db.prepare('UPDATE cards SET focus = 0 WHERE focus = 1').run();
    const set = db.prepare('UPDATE cards SET focus = 1 WHERE id = ?');
    for (const id of ids) set.run(id);
    return ids.map((id) => getCard(db, id));
  });
}

export const columnLabel = (c: string) => COLUMN_LABELS[c as keyof typeof COLUMN_LABELS] ?? c;

// ------------------------------------------------------------------ projects

export function createProject(db: Db, raw: unknown): Project {
  const input = projectInput.parse(raw);
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM work_projects WHERE name = ? COLLATE NOCASE').get(input.name)) throw new UserError(`There's already a project called "${input.name}".`, 409);
    if (input.categoryId != null) getCategory(db, input.categoryId);
    const count = (db.prepare('SELECT count(*) AS n FROM work_projects').get() as { n: number }).n;
    // The colour column predates categories and is no longer read.
    const { lastInsertRowid } = db
      .prepare('INSERT INTO work_projects (name, colour, status, position, category_id) VALUES (?, ?, ?, ?, ?)')
      .run(input.name, UNCATEGORISED, input.status, count, input.categoryId);
    return getProject(db, Number(lastInsertRowid));
  });
}

export function updateProject(db: Db, id: number, raw: unknown): Project {
  const patch = projectPatch.parse(raw);
  return transaction(db, () => {
    const p = { ...getProject(db, id), ...patch };
    const clash = db.prepare('SELECT id FROM work_projects WHERE name = ? COLLATE NOCASE AND id != ?').get(p.name, id);
    if (clash) throw new UserError(`There's already a project called "${p.name}".`, 409);
    if (p.categoryId != null) getCategory(db, p.categoryId);
    db.prepare('UPDATE work_projects SET name = ?, category_id = ?, status = ? WHERE id = ?').run(p.name, p.categoryId, p.status, id);
    return getProject(db, id);
  });
}

export function deleteProject(db: Db, id: number): Project {
  return transaction(db, () => {
    const p = getProject(db, id);
    const n = (db.prepare('SELECT count(*) AS n FROM cards WHERE project_id = ?').get(id) as { n: number }).n;
    if (n) throw new UserError(`${p.name} still has ${n} card${n === 1 ? '' : 's'}. Move or delete them first, or pause the project instead.`);
    db.prepare('DELETE FROM work_projects WHERE id = ?').run(id);
    return p;
  });
}

// ------------------------------------------------------------------ categories

export function listCategories(db: Db): Category[] {
  return (db.prepare('SELECT * FROM work_categories ORDER BY position, id').all() as Row[]).map(rowToCategory);
}

function getCategory(db: Db, id: number): Category {
  const r = db.prepare('SELECT * FROM work_categories WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new UserError(`There's no category ${id}.`, 404);
  return rowToCategory(r);
}

/** A category by id or name, for chat. Unknown names list the ones that exist. */
export function resolveCategory(db: Db, key: string | number): Category {
  if (typeof key === 'number' || /^\d+$/.test(key)) return getCategory(db, Number(key));
  const r = db.prepare('SELECT * FROM work_categories WHERE name = ? COLLATE NOCASE').get(key.trim()) as Row | undefined;
  if (r) return rowToCategory(r);
  const names = listCategories(db).map((c) => c.name);
  throw new UserError(`No category called "${key}". ${names.length ? `Categories: ${names.join(', ')}.` : 'There are no categories yet.'} Add one with the category command.`);
}

export function createCategory(db: Db, raw: unknown): Category {
  const input = categoryInput.parse(raw);
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM work_categories WHERE name = ? COLLATE NOCASE').get(input.name)) throw new UserError(`There's already a category called "${input.name}".`, 409);
    const all = listCategories(db);
    const used = new Set(all.map((c) => c.colour.toLowerCase()));
    const colour = input.colour ?? CATEGORY_COLOURS.find((c) => !used.has(c)) ?? CATEGORY_COLOURS[all.length % CATEGORY_COLOURS.length]!;
    const position = all.reduce((m, c) => Math.max(m, c.position + 1), 0);
    const { lastInsertRowid } = db.prepare('INSERT INTO work_categories (name, colour, position) VALUES (?, ?, ?)').run(input.name, colour.toLowerCase(), position);
    return getCategory(db, Number(lastInsertRowid));
  });
}

export function updateCategory(db: Db, id: number, raw: unknown): Category {
  const patch = categoryPatch.parse(raw);
  return transaction(db, () => {
    const c = { ...getCategory(db, id), ...patch };
    if (db.prepare('SELECT 1 FROM work_categories WHERE name = ? COLLATE NOCASE AND id != ?').get(c.name, id)) throw new UserError(`There's already a category called "${c.name}".`, 409);
    db.prepare('UPDATE work_categories SET name = ?, colour = ? WHERE id = ?').run(c.name, c.colour.toLowerCase(), id);
    return getCategory(db, id);
  });
}

/** Its projects stay, uncategorised. */
export function deleteCategory(db: Db, id: number): Category {
  const c = getCategory(db, id);
  db.prepare('DELETE FROM work_categories WHERE id = ?').run(id);
  return c;
}

// ------------------------------------------------------------------ submissions

function touch(db: Db, cardId: number) {
  db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now(), cardId);
}

function checkSubmissionDates(s: { sentOn: string; followUpOn: string | null; respondedOn: string | null }) {
  if (s.respondedOn && s.respondedOn < s.sentOn) throw new UserError("The response can't come before it was sent.");
  if (s.followUpOn && s.followUpOn < s.sentOn) throw new UserError("The follow-up date can't be before it was sent.");
}

export function addSubmission(db: Db, cardId: number, raw: unknown, today: DateStr): Submission {
  const input = submissionInput.parse(raw);
  return transaction(db, () => {
    const card = getCard(db, cardId);
    if (card.board !== 'film') throw new UserError('Submissions are for Film & TV cards.');
    const sentOn = input.sentOn ?? today;
    const s = {
      ...input,
      sentOn,
      followUpOn: input.followUpOn === undefined ? addDays(sentOn, FOLLOW_UP_DAYS) : input.followUpOn,
      // A response logged without a date was heard today.
      respondedOn: input.response ? (input.respondedOn ?? today) : input.respondedOn,
    };
    checkSubmissionDates(s);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO submissions (card_id, recipient, sent_on, follow_up_on, response, responded_on, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(cardId, s.recipient, s.sentOn, s.followUpOn, s.response, s.respondedOn, s.notes, now());
    touch(db, cardId);
    return getSubmission(db, Number(lastInsertRowid));
  });
}

export function updateSubmission(db: Db, id: number, raw: unknown, today: DateStr): Submission {
  const patch = submissionPatch.parse(raw);
  return transaction(db, () => {
    const before = getSubmission(db, id);
    const s = { ...before, ...patch };
    // A response logged without a date was heard today.
    if (s.response && !before.response && patch.respondedOn === undefined && !s.respondedOn) s.respondedOn = today;
    if (!s.response && patch.response === null && patch.respondedOn === undefined) s.respondedOn = null;
    checkSubmissionDates(s);
    db.prepare('UPDATE submissions SET recipient = ?, sent_on = ?, follow_up_on = ?, response = ?, responded_on = ?, notes = ? WHERE id = ?').run(
      s.recipient,
      s.sentOn,
      s.followUpOn,
      s.response,
      s.respondedOn,
      s.notes,
      id,
    );
    touch(db, before.cardId);
    return getSubmission(db, id);
  });
}

export function deleteSubmission(db: Db, id: number): Submission {
  return transaction(db, () => {
    const s = getSubmission(db, id);
    db.prepare('DELETE FROM submissions WHERE id = ?').run(id);
    touch(db, s.cardId);
    return s;
  });
}
