import type { DateStr } from '../dates.ts';
import type { Board, Column, FORMATS, KINDS, PROJECT_STATUSES } from './schemas.ts';

export type Link = { label: string | null; url: string };

export type Card = {
  id: number;
  board: Board;
  column: Column;
  /** Order within the column: 0 is the top, and the top is the priority. */
  position: number;
  title: string;
  notes: string | null;
  links: Link[];
  due: DateStr | null;
  focus: boolean;
  logline: string | null;
  format: (typeof FORMATS)[number] | null;
  draft: string | null;
  draftDate: DateStr | null;
  nextAction: string | null;
  projectId: number | null;
  kind: (typeof KINDS)[number];
  createdAt: string;
  /** Any edit, move or submission. "Untouched" is measured from here. */
  updatedAt: string;
  /** The local day it went to Done, or null. */
  doneOn: DateStr | null;
};

export type Category = { id: number; name: string; colour: string; position: number };

/** `colour` is the category's, or grey with no category. */
export type Project = { id: number; name: string; categoryId: number | null; colour: string; status: (typeof PROJECT_STATUSES)[number]; position: number };

export type Submission = {
  id: number;
  cardId: number;
  recipient: string;
  sentOn: DateStr;
  followUpOn: DateStr | null;
  /** Null while it's still out with them. */
  response: string | null;
  respondedOn: DateStr | null;
  notes: string | null;
};

export type WorkSnapshot = { today: DateStr; cards: Card[]; projects: Project[]; categories: Category[]; submissions: Submission[] };
