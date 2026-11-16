// One board component for both boards: columns in priority order, drag and
// drop (or Alt+arrow keys) to move, Space to peek, and quick add at the foot
// of each column. Any column can fold to a narrow strip and still take drops.

import { useEffect, useRef, useState } from 'react';
import { daysBetween, formatShort } from '../../../shared/dates.ts';
import { COLUMN_LABELS, COLUMNS, type Board as BoardName, type Column } from '../../../shared/work/schemas.ts';
import type { Card, Project, WorkSnapshot } from '../../../shared/work/types.ts';
import { api } from '../../lib/api.ts';
import { IconArrowRight, IconBug, IconFlag, IconFold, IconPlus, IconSend, IconStar } from '../../ui/icons.tsx';
import { toast } from '../../ui/toast.tsx';
import { boardCards, openSubmission } from '../../work/derive.ts';
import { workMutate, workStore } from '../../work/store.ts';
import { useWatch } from '../../watch/store.ts';

type Drop = { column: Column; before: number | null };

/** Which optional details the cards show: a per-browser setting from the Display menu. */
export type CardDisplay = { logline: boolean; nextAction: boolean; project: boolean; colour?: boolean };

/** The cards a column shows, in order. */
export function columnCards(cards: Card[], column: Column, projects: Map<number, Project>, filter: number | null) {
  let list = cards.filter((c) => c.column === column && (filter == null || c.projectId === filter));
  // Paused projects' cards stay out of Next until the project is active again.
  if (column === 'next') list = list.filter((c) => !c.projectId || projects.get(c.projectId)?.status !== 'paused');
  // Done reads newest first; everywhere else the order is the priority.
  if (column === 'done') list = [...list].sort((a, b) => (b.doneOn ?? '').localeCompare(a.doneOn ?? '') || b.updatedAt.localeCompare(a.updatedAt));
  return list;
}

/** The snapshot as it will be after a move, so the card lands at once. */
function previewMove(s: WorkSnapshot, id: number, to: Drop): WorkSnapshot {
  const card = s.cards.find((c) => c.id === id)!;
  const order = s.cards.filter((c) => c.board === card.board && c.column === to.column && c.id !== id).sort((a, b) => a.position - b.position);
  const at = to.before == null ? -1 : order.findIndex((c) => c.id === to.before);
  order.splice(at === -1 ? order.length : at, 0, card);
  const pos = new Map(order.map((c, i) => [c.id, i]));
  return {
    ...s,
    cards: s.cards.map((c) =>
      c.id === id
        ? { ...c, column: to.column, position: pos.get(c.id)!, doneOn: to.column === 'done' ? (c.doneOn ?? s.today) : null, focus: to.column === 'done' ? false : c.focus }
        : pos.has(c.id)
          ? { ...c, position: pos.get(c.id)! }
          : c,
    ),
  };
}

export async function moveCard(id: number, to: Drop) {
  const s = workStore.get();
  if (s) workStore.preview(previewMove(s, id, to));
  try {
    await workMutate(() => api.post(`/api/work/cards/${id}/move`, to));
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

export function Board({
  data,
  board,
  filter,
  groupDoing,
  display,
  folded,
  peeking,
  onFold,
  onPeek,
  onNew,
}: {
  data: WorkSnapshot;
  board: BoardName;
  filter: number | null;
  groupDoing: boolean;
  display: CardDisplay;
  folded: Column[];
  /** The card open in the peek, if any. */
  peeking: number | null;
  onFold: (column: Column) => void;
  /** Open a card in the peek, or close the peek with null. */
  onPeek: (id: number | null) => void;
  onNew: (column: Column) => void;
}) {
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const cards = boardCards(data, board);
  // Watchlist titles tagged as comparisons, by Film & TV card.
  const watchItems = useWatch().data?.items ?? [];
  const comps = new Map<number, string[]>();
  for (const w of watchItems) for (const id of w.comps) comps.set(id, [...(comps.get(id) ?? []), w.title]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const refocus = useRef<number | null>(null);
  const hovered = useRef<number | null>(null);

  // Space peeks at the card under the pointer or with keyboard focus, and closes the peek again.
  const peekRef = useRef({ peeking, onPeek });
  peekRef.current = { peeking, onPeek };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable || document.querySelector('.sheet')) return;
      const focused = t.closest<HTMLElement>('[data-card]');
      if (!focused && t !== document.body) return;
      const id = focused ? Number(focused.dataset.card) : hovered.current;
      const { peeking: open, onPeek: peek } = peekRef.current;
      if (id == null && open == null) return;
      e.preventDefault();
      peek(id == null || id === open ? null : id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The card in the peek stays in view, as J and K step through a column.
  useEffect(() => {
    if (peeking != null) document.querySelector(`[data-card="${peeking}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [peeking]);

  // After a keyboard move, keep focus on the card that moved.
  useEffect(() => {
    if (refocus.current == null) return;
    document.querySelector<HTMLElement>(`[data-card="${refocus.current}"]`)?.focus();
    refocus.current = null;
  });

  const over = (e: React.DragEvent, column: Column) => {
    if (dragging == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tiles = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-card]')].filter((t) => Number(t.dataset.card) !== dragging);
    const below = tiles.find((t) => {
      const r = t.getBoundingClientRect();
      return r.top + r.height / 2 > e.clientY;
    });
    const before = below ? Number(below.dataset.card) : null;
    if (drop?.column !== column || drop.before !== before) setDrop({ column, before });
  };

  const end = () => {
    setDragging(null);
    setDrop(null);
  };

  const dropHere = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragging != null && drop) void moveCard(dragging, drop);
    end();
  };

  /** `shown` is the list as it appears (one project's group when Doing is grouped); `full` is the column's real order. */
  const keyMove = (e: React.KeyboardEvent, card: Card, shown: Card[], full: Card[]) => {
    if (!e.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const cols = COLUMNS[board] as readonly Column[];
    const i = shown.findIndex((c) => c.id === card.id);
    let to: Drop | null = null;
    // With Shift too, straight to the top or the bottom of the column.
    if (e.shiftKey && e.key === 'ArrowUp' && i > 0) to = { column: card.column, before: shown[0]!.id };
    else if (e.shiftKey && e.key === 'ArrowDown' && i < shown.length - 1) to = { column: card.column, before: full.slice(full.findIndex((c) => c.id === shown.at(-1)!.id) + 1).find((c) => c.id !== card.id)?.id ?? null };
    else if (e.key === 'ArrowUp' && i > 0) to = { column: card.column, before: shown[i - 1]!.id };
    else if (e.key === 'ArrowDown' && i < shown.length - 1) {
      // Just below the next card: above whatever follows it in the real order.
      const next = full.findIndex((c) => c.id === shown[i + 1]!.id);
      to = { column: card.column, before: full.slice(next + 1).find((c) => c.id !== card.id)?.id ?? null };
    }
    const c = cols.indexOf(card.column) + (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') if (c >= 0 && c < cols.length) to = { column: cols[c]!, before: null };
    if (!to) return;
    refocus.current = card.id;
    void moveCard(card.id, to);
  };

  return (
    <div className={`board board-${board}`}>
      {(COLUMNS[board] as readonly Column[]).map((column) => {
        const list = columnCards(cards, column, projects, filter);
        const hidden = column === 'next' ? cards.filter((c) => c.column === 'next' && c.projectId && projects.get(c.projectId)?.status === 'paused').length : 0;
        const groups = column === 'doing' && groupDoing ? groupByProject(list, projects) : null;
        const isFolded = folded.includes(column);
        const dropProps = {
          onDragOver: (e: React.DragEvent) => over(e, column),
          onDragLeave: (e: React.DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop((d) => (d?.column === column ? null : d));
          },
          onDrop: dropHere,
        };
        if (isFolded) {
          return (
            <section key={column} className={`col col-folded col-${column} ${drop?.column === column ? 'drop-target' : ''}`} style={{ '--col': RING[column].tint } as React.CSSProperties} aria-label={`${COLUMN_LABELS[column]}, folded`} {...dropProps}>
              <button className="col-unfold" onClick={() => onFold(column)} title={`Show ${COLUMN_LABELS[column]}`}>
                <ColumnIcon column={column} />
                <span className="col-count num">{list.length}</span>
                <span className="col-folded-name">{COLUMN_LABELS[column]}</span>
              </button>
            </section>
          );
        }
        const tile = (card: Card, shown: Card[]) => (
          <li key={card.id} className="col-item" onMouseEnter={() => (hovered.current = card.id)} onMouseLeave={() => (hovered.current = null)}>
            {drop?.column === column && drop.before === card.id ? <span className="drop-line" aria-hidden="true" /> : null}
            <Tile
              card={card}
              data={data}
              project={card.projectId ? projects.get(card.projectId) : undefined}
              comps={comps.get(card.id) ?? []}
              display={display}
              dragging={dragging === card.id}
              open={peeking === card.id}
              onOpen={() => onPeek(card.id)}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', String(card.id));
                e.dataTransfer.effectAllowed = 'move';
                setDragging(card.id);
              }}
              onDragEnd={end}
              onKeyDown={(e) => keyMove(e, card, shown, list)}
            />
          </li>
        );
        return (
          <section key={column} className={`col col-${column} ${drop?.column === column ? 'drop-target' : ''}`} style={{ '--col': RING[column].tint } as React.CSSProperties} aria-label={COLUMN_LABELS[column]} {...dropProps}>
            <header className="col-head">
              <ColumnIcon column={column} />
              <h2>{COLUMN_LABELS[column]}</h2>
              <span className="col-actions">
                <button className="col-btn" onClick={() => onFold(column)} title={`Fold ${COLUMN_LABELS[column]}`} aria-label={`Fold ${COLUMN_LABELS[column]}`}>
                  <IconFold />
                </button>
                {column === 'done' ? null : (
                  <button className="col-btn" onClick={() => onNew(column)} title={`New card in ${COLUMN_LABELS[column]}`} aria-label={`New card in ${COLUMN_LABELS[column]}`}>
                    <IconPlus />
                  </button>
                )}
              </span>
              <span className="col-count num">{list.length || ''}</span>
            </header>
            <ol className="col-list">
              {groups
                ? groups.map((g) => (
                    <li key={g.key} className="col-group">
                      <span className="col-group-name">
                        {g.project ? <span className="dot" style={{ background: g.project.colour }} /> : null}
                        {g.project?.name ?? 'No project'}
                        <span className="faint num">{g.cards.length}</span>
                      </span>
                      <ol className="col-list">{g.cards.map((c) => tile(c, g.cards))}</ol>
                    </li>
                  ))
                : list.map((c) => tile(c, list))}
              {drop?.column === column && drop.before == null ? <li className="drop-line" aria-hidden="true" /> : null}
            </ol>
            {!list.length && !(drop?.column === column) ? (
              <div className="col-empty" aria-hidden="true">
                <ColumnIcon column={column} />
                <p>{EMPTY_LINE[column]}</p>
              </div>
            ) : null}
            {hidden ? <p className="col-note faint">{hidden} from paused projects hidden</p> : null}
            {column === 'done' ? (
              list.length ? <p className="col-note faint">Cards clear two weeks after they're done.</p> : null
            ) : (
              <QuickAdd board={board} column={column} projectId={filter} onMore={() => onNew(column)} />
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Each column's mark: a ring that fills as work moves along the board,
 * a tick when it's done, a slash when it's shelved.
 */
/*
 * Every stage has a colour of its own, so the board reads as a run of colour
 * from left to right: cool where work waits, warm where it's under way, green
 * where it's landed. Only Shelved is muted.
 */
const RING: Record<Column, { fill: number; tint: string; dashed?: boolean; tick?: boolean; slash?: boolean }> = {
  backlog: { fill: 0, tint: '#8f9cf5', dashed: true },
  next: { fill: 0, tint: '#4fc3f7' },
  doing: { fill: 0.5, tint: '#ffb340' },
  done: { fill: 1, tint: '#34d27b', tick: true },
  ideas: { fill: 0, tint: '#b69cff', dashed: true },
  developing: { fill: 0.25, tint: '#ff8f4d' },
  writing: { fill: 0.5, tint: '#ffc53d' },
  out: { fill: 0.75, tint: '#4fd1e8' },
  'in-play': { fill: 1, tint: '#34d27b', tick: true },
  shelved: { fill: 0, tint: '#a497b0', slash: true },
};

/** A stage's colour, for anything that shows a card's column elsewhere (Today). */
export const stageColour = (column: Column) => RING[column].tint;

/** What an empty lane is for, in a line. */
const EMPTY_LINE: Record<Column, string> = {
  backlog: 'Later, in no hurry.',
  next: 'Up next, in order.',
  doing: 'Nothing under way.',
  done: 'Finished cards stay two weeks.',
  ideas: 'Where every script starts.',
  developing: 'Ideas taking shape.',
  writing: 'Drafts in progress.',
  out: 'Scripts with someone.',
  'in-play': 'Optioned, funded or shooting.',
  shelved: 'Set aside, not forgotten.',
};

export function ColumnIcon({ column }: { column: Column }) {
  const r = RING[column];
  // A pie wedge from 12 o'clock, clockwise.
  const a = r.fill * 2 * Math.PI;
  const x = 8 + 3.5 * Math.sin(a);
  const y = 8 - 3.5 * Math.cos(a);
  return (
    <svg className="col-icon" viewBox="0 0 16 16" aria-hidden="true" style={{ color: r.tint }}>
      {r.tick ? (
        <>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" />
          <path d="m5.2 8.2 1.9 1.9 3.7-3.9" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={r.dashed ? '2.2 2.1' : undefined} />
          {r.fill > 0 ? <path d={`M8 8V4.5A3.5 3.5 0 ${r.fill > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`} fill="currentColor" /> : null}
          {r.slash ? <path d="m5.5 10.5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /> : null}
        </>
      )}
    </svg>
  );
}

function groupByProject(list: Card[], projects: Map<number, Project>) {
  const groups = new Map<string, { key: string; project: Project | undefined; cards: Card[] }>();
  for (const c of list) {
    const key = String(c.projectId ?? 'none');
    if (!groups.has(key)) groups.set(key, { key, project: c.projectId ? projects.get(c.projectId) : undefined, cards: [] });
    groups.get(key)!.cards.push(c);
  }
  return [...groups.values()];
}

// ------------------------------------------------------------------ tile

/**
 * A card's colour. Software cards wear their project's, and stay neutral
 * without one. A script on Film & TV always has one: its project's, or a
 * steady colour of its own from its title, like a cover.
 */
// Ten cover colours chosen to darken well: indigo, violet, magenta, rose, coral, gold, emerald, teal, cyan, blue.
const COVER_HUES = [268, 300, 335, 12, 40, 78, 152, 178, 205, 238];

export function cardColour(card: Card, project: Project | undefined): string | null {
  if (project) return project.colour;
  if (card.board !== 'film') return null;
  // Stepping by seven of ten keeps cards made one after another far apart on the wheel.
  return `oklch(0.68 0.13 ${COVER_HUES[(card.id * 7) % COVER_HUES.length]})`;
}

function Tile({
  card,
  data,
  project,
  comps,
  display,
  dragging,
  open,
  onOpen,
  onDragStart,
  onDragEnd,
  onKeyDown,
}: {
  card: Card;
  data: WorkSnapshot;
  project: Project | undefined;
  comps: string[];
  display: CardDisplay;
  dragging: boolean;
  open: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const film = card.board === 'film';
  const out = film ? openSubmission(data, card.id) : undefined;
  const dueIn = card.due ? daysBetween(data.today, card.due) : null;
  const overdue = dueIn != null && dueIn < 0 && card.column !== 'done';
  const bug = !film && card.kind === 'bug';
  const colour = display.colour !== false ? cardColour(card, project) : null;
  const finished = card.column === 'done' || card.column === 'shelved';

  const due =
    card.due && card.column !== 'done' ? (
      <span className={`tile-fact tile-due ${overdue ? 'overdue' : dueIn != null && dueIn <= 3 ? 'soon' : ''}`}>
        <IconFlag /> {dueIn === 0 ? 'Today' : dueIn === 1 ? 'Tomorrow' : formatShort(card.due)}
      </span>
    ) : null;
  const done = card.doneOn ? <span className="tile-fact tile-done">Done {formatShort(card.doneOn)}</span> : null;

  const props = {
    className: `tile ${film ? 'tile-film' : 'tile-sw'} ${colour ? 'tinted' : ''} ${finished ? 'finished' : ''} ${dragging ? 'dragging' : ''} ${open ? 'open' : ''}`,
    style: colour ? ({ '--tint': colour } as React.CSSProperties) : undefined,
    'data-card': card.id,
    draggable: true,
    onDragStart,
    onDragEnd,
    onClick: onOpen,
    onKeyDown,
    'aria-pressed': open,
    title: 'Space or click to peek. Drag, or Alt and the arrow keys, to move it.',
  };

  if (!film) {
    return (
      <button {...props}>
        {(project && display.project) || bug ? (
          <span className="tile-top">
            {project && display.project ? (
              <span className="tile-proj">
                <span className="dot" />
                {project.name}
              </span>
            ) : (
              <span />
            )}
            <span className="tile-marks">
              {bug ? (
                <span className="tile-bug">
                  <IconBug /> Bug
                </span>
              ) : null}
              {card.focus ? <IconStar filled className="tile-star" /> : null}
            </span>
          </span>
        ) : null}
        {/* With no label row, the focus star sits beside the title rather than alone above it. */}
        {(project && display.project) || bug || !card.focus ? (
          <span className="tile-title">{card.title}</span>
        ) : (
          <span className="tile-title-row">
            <span className="tile-title">{card.title}</span>
            <IconStar filled className="tile-star" />
          </span>
        )}
        {due || done ? (
          <span className="tile-meta">
            {due}
            {done}
          </span>
        ) : null}
      </button>
    );
  }

  // A script: a cover in its colour with the title on it, then the working details.
  const body =
    (display.logline && card.logline) || (display.nextAction && card.nextAction && card.column !== 'shelved') || comps.length || out || due || done || (project && display.project);
  return (
    <button {...props}>
      <span className="tile-cover">
        <span className="tile-cover-top">
          {card.format ? <span className="tile-format">{card.format}</span> : null}
          {card.draft ? (
            <span className="tile-draft">
              {card.draft}
              {card.draftDate ? `, ${formatShort(card.draftDate)}` : ''}
            </span>
          ) : null}
          {card.focus ? <IconStar filled className="tile-star" /> : null}
        </span>
        <span className="tile-title">{card.title}</span>
      </span>
      {body ? (
        <span className="tile-body">
          {display.logline && card.logline ? <span className="tile-logline">{card.logline}</span> : null}
          {display.nextAction && card.nextAction && card.column !== 'shelved' ? (
            <span className="tile-next">
              <IconArrowRight /> {card.nextAction}
            </span>
          ) : null}
          {comps.length ? <span className="tile-comps">Comps: {comps.join(', ')}</span> : null}
          {out || due || done || (project && display.project) ? (
            <span className="tile-meta">
              {out ? (
                <span className="tile-fact tile-out" title={`Sent ${formatShort(out.sentOn)}`}>
                  <IconSend /> {out.recipient}
                  <span className="num">{daysBetween(out.sentOn, data.today)}d</span>
                </span>
              ) : null}
              {due}
              {done}
              {project && display.project ? (
                <span className="tile-fact tile-proj-chip">
                  <span className="dot" />
                  {project.name}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

// ------------------------------------------------------------------ quick add

function QuickAdd({ board, column, projectId, onMore }: { board: BoardName; column: Column; projectId: number | null; onMore: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button className="col-add" onClick={() => setOpen(true)}>
        <IconPlus /> Add a card
      </button>
    );
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await workMutate(() => api.post('/api/work/cards', { board, column, title, projectId }));
      setTitle('');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="col-quick" onSubmit={add}>
      <input
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title, then Enter"
        aria-label={`New card in ${COLUMN_LABELS[column]}`}
        autoFocus
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))}
        onBlur={() => !title.trim() && setOpen(false)}
      />
      <button type="button" className="link-btn faint small" onMouseDown={(e) => e.preventDefault()} onClick={onMore}>
        More fields
      </button>
    </form>
  );
}
