// What the Work screens and Today work out from the snapshot.

import { addDays, daysBetween, weekStart, type DateStr } from '../../shared/dates.ts';
import { DONE_CLEARS_AFTER, UNTOUCHED_DAYS, type Board } from '../../shared/work/schemas.ts';
import type { Card, Link, Submission, WorkSnapshot } from '../../shared/work/types.ts';

/** Local day of an ISO instant. */
export const dayOf = (iso: string): DateStr => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Cards on a board, with Done cleared after two weeks. */
export function boardCards(s: WorkSnapshot, board: Board): Card[] {
  const cutoff = addDays(s.today, -DONE_CLEARS_AFTER);
  return s.cards.filter((c) => c.board === board && !(c.doneOn && c.doneOn < cutoff)).sort((a, b) => a.position - b.position);
}

/** The submission a card is out on now: the latest with no response. */
export function openSubmission(s: WorkSnapshot, cardId: number): Submission | undefined {
  return s.submissions.filter((x) => x.cardId === cardId && !x.response).at(-1);
}

/** What shipped this week (Monday on): software cards done, and on Film & TV, submissions sent and drafts finished. */
export function shippedThisWeek(s: WorkSnapshot) {
  const from = weekStart(s.today);
  const byId = new Map(s.cards.map((c) => [c.id, c]));
  return {
    from,
    done: s.cards.filter((c) => c.doneOn && c.doneOn >= from),
    sent: s.submissions.filter((x) => x.sentOn >= from && x.sentOn <= s.today).map((x) => ({ submission: x, card: byId.get(x.cardId)! })),
    drafts: s.cards.filter((c) => c.board === 'film' && c.draftDate && c.draftDate >= from && c.draftDate <= s.today),
  };
}

export const shippedCount = (x: ReturnType<typeof shippedThisWeek>) => x.done.length + x.sent.length + x.drafts.length;

/** Columns where a card is being worked on, so going quiet is worth noticing. */
const ACTIVE = new Set(['developing', 'writing', 'out', 'in-play', 'next', 'doing']);

export function untouched(s: WorkSnapshot): { card: Card; days: number }[] {
  return s.cards
    .filter((c) => ACTIVE.has(c.column))
    .map((card) => ({ card, days: daysBetween(dayOf(card.updatedAt), s.today) }))
    .filter((x) => x.days >= UNTOUCHED_DAYS)
    .sort((a, b) => b.days - a.days);
}

/** Submissions still out whose follow-up date has come, oldest first. */
export function followUpsDue(s: WorkSnapshot, within = 0): { submission: Submission; card: Card }[] {
  const byId = new Map(s.cards.map((c) => [c.id, c]));
  const until = addDays(s.today, within);
  return s.submissions
    .filter((x) => !x.response && x.followUpOn && x.followUpOn <= until)
    .sort((a, b) => a.followUpOn!.localeCompare(b.followUpOn!))
    .map((submission) => ({ submission, card: byId.get(submission.cardId)! }))
    .filter((x) => x.card);
}

/** "Draft notes https://docs.google.com/..." per line. */
export function parseLinks(text: string): Link[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)\s*(https?:\/\/\S+)$/);
      return m ? { label: m[1]!.trim() || null, url: m[2]! } : { label: null, url: line };
    });
}

export const formatLinks = (links: Link[]) => links.map((l) => (l.label ? `${l.label} ${l.url}` : l.url)).join('\n');

/** "docs.google.com" for a link with no label. */
export function linkLabel(l: Link): string {
  if (l.label) return l.label;
  try {
    return new URL(l.url).hostname.replace(/^www\./, '');
  } catch {
    return l.url;
  }
}
