import type { DateStr } from '../dates.ts';

export const DOC_KINDS = ['markdown', 'text', 'pdf', 'word', 'script'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const KIND_LABELS: Record<DocKind, string> = { markdown: 'Markdown', text: 'Text', pdf: 'PDF', word: 'Word', script: 'Scripts' };

/** File extensions the search and the viewer handle, and what each is. */
export const EXT_KINDS: Record<string, DocKind> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.pdf': 'pdf',
  '.docx': 'word',
  '.fdx': 'script',
  '.fountain': 'script',
  '.sotto': 'script',
};

/** One screenplay element. Types follow Sotto's names: sceneHeading, action, character, parenthetical, dialogue, transition... */
export type ScriptLine = { type: string; text: string; align?: 'center' | 'right' };

export type DocContent =
  | { type: 'markdown'; text: string }
  | { type: 'text'; text: string }
  | { type: 'script'; title: string | null; lines: ScriptLine[] }
  | { type: 'word'; paragraphs: { style: string | null; text: string }[] }
  | { type: 'pdf'; pages: number; text: string };

export type DocFile = {
  path: string;
  /** The path with the home folder written as ~, for showing. */
  display: string;
  name: string;
  kind: DocKind;
  size: number;
  modified: string;
};

export type DocView = DocFile & { content: DocContent };

export type SearchHit = DocFile & {
  /** Matching text with \u0002 before and \u0003 after each match. Null when only the name matched. */
  snippet: string | null;
  nameMatch: boolean;
};

export type IndexStatus = {
  files: number;
  lastRun: string | null;
  running: boolean;
  error: string | null;
  roots: string[];
  exclude: string[];
};

export type Idea = {
  id: number;
  text: string;
  createdAt: string;
  status: 'inbox' | 'sorted' | 'archived';
  /** Where it went: "card 12", "note Plot ideas.md", "watchlist 3". */
  outcome: string | null;
  outcomeLink: string | null;
};

export type SavedLink = { id: number; url: string; title: string | null; note: string | null; project: string | null; createdAt: string };

export type Note = {
  /** The file name inside the notes folder, like "Plot ideas.md". It's the note's id. */
  file: string;
  title: string;
  project: string | null;
  body: string;
  modified: string;
  created: DateStr | null;
};

export type NoteSummary = Omit<Note, 'body'> & { excerpt: string };

export type NotesSnapshot = {
  today: DateStr;
  ideas: Idea[];
  links: SavedLink[];
  notes: NoteSummary[];
  notesDir: string;
  /** Names the user's notes and links can attach to: software projects and Film & TV cards. */
  projects: string[];
};
