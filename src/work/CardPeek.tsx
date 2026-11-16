// The card peek: a panel at the right of the board. The board stays usable
// beside it, and every field saves when you leave it, so there's no Save button.
// New cards still start in the CardSheet dialog.

import { useEffect, useRef, useState } from 'react';
import { formatShort, relativeDay } from '../../shared/dates.ts';
import { BOARD_LABELS, COLUMN_LABELS, COLUMNS, FORMATS, MAX_FOCUS, type Column } from '../../shared/work/schemas.ts';
import type { Card, WorkSnapshot } from '../../shared/work/types.ts';
import { api } from '../lib/api.ts';
import { useKey } from '../lib/hooks.ts';
import { IconArrowDown, IconArrowUp, IconClose, IconExternal, IconStar, IconTrash } from '../ui/icons.tsx';
import { toast } from '../ui/toast.tsx';
import { confirmAction } from '../ui/confirm.tsx';
import { cardColour, ColumnIcon } from '../views/work/Board.tsx';
import { Comps, Submissions } from './CardSheet.tsx';
import { dayOf, formatLinks, linkLabel, parseLinks } from './derive.ts';
import { workMutate } from './store.ts';

const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function CardPeek({ data, cardId, prev, next, onGo, onClose }: { data: WorkSnapshot; cardId: number; prev?: number; next?: number; onGo: (id: number) => void; onClose: () => void }) {
  const card = data.cards.find((c) => c.id === cardId);
  const panel = useRef<HTMLElement>(null);
  const [saved, setSaved] = useState(0);

  // A dialog opened over the peek (a new card, an idea) takes these keys first.
  const dialog = () => !!document.querySelector('.sheet');
  useKey('Escape', () => !dialog() && onClose());
  useKey('j', () => !dialog() && next != null && onGo(next));
  useKey('k', () => !dialog() && prev != null && onGo(prev));

  // A click anywhere but the peek, a card, a menu or a dialog closes it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.isConnected || t.closest('.peek, [data-card], .menu-wrap, .sheet, .sheet-backdrop, .toasts')) return;
      closeRef.current();
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, []);

  if (!card) {
    return (
      <aside className="peek" aria-label="Card">
        <div className="peek-bar">
          <span className="peek-crumb">Card not found</span>
          <button className="peek-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <p className="peek-missing muted">Card {cardId} isn't on the boards any more. It may have been deleted.</p>
      </aside>
    );
  }

  const film = card.board === 'film';
  const project = data.projects.find((p) => p.id === card.projectId);
  // The peek wears the card's colour, so it reads as the same thing opened up.
  const colour = cardColour(card, project);
  const focusTaken = data.cards.filter((c) => c.focus && c.id !== card.id).length >= MAX_FOCUS;

  /** Save some fields. False when the server refused, so the field can go back. */
  const save = async (patch: Partial<Card>): Promise<boolean> => {
    try {
      await workMutate(() => api.put(`/api/work/cards/${card.id}`, patch));
      setSaved((n) => n + 1);
      return true;
    } catch (err) {
      toast((err as Error).message, 'error');
      return false;
    }
  };
  const text = (field: keyof Card) => (v: string) => save({ [field]: v.trim() || null });
  const move = async (column: Column) => {
    try {
      await workMutate(() => api.post(`/api/work/cards/${card.id}/move`, { column }));
      setSaved((n) => n + 1);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const remove = async () => {
    if (!(await confirmAction({ title: `Delete “${card.title}”?`, body: "This can't be undone." }))) return;
    try {
      await workMutate(() => api.del(`/api/work/cards/${card.id}`));
      toast('Card deleted');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <aside className={`peek ${colour ? 'tinted' : ''}`} style={colour ? ({ '--tint': colour } as React.CSSProperties) : undefined} aria-label={`Card: ${card.title}`} ref={panel}>
      <div className="peek-bar">
        <span className="peek-crumb">
          <ColumnIcon column={card.column} />
          {BOARD_LABELS[card.board]}
          {project ? (
            <>
              <span className="faint">/</span>
              <span className="dot" style={{ background: project.colour }} />
              {project.name}
            </>
          ) : null}
        </span>
        {saved ? (
          <span key={saved} className="peek-saved">
            Saved
          </span>
        ) : null}
        <span className="peek-tools">
          <button
            className={`peek-btn ${card.focus ? 'on' : ''}`}
            onClick={() => void save({ focus: !card.focus })}
            disabled={card.column === 'done' || (focusTaken && !card.focus)}
            aria-pressed={card.focus}
            title={card.column === 'done' ? 'Done cards leave focus' : focusTaken && !card.focus ? `${MAX_FOCUS} cards are already in focus` : card.focus ? 'In focus, on Today' : 'Put in focus, on Today'}
          >
            <IconStar filled={card.focus} />
          </button>
          <button className="peek-btn" onClick={() => prev != null && onGo(prev)} disabled={prev == null} title="Previous card (K)" aria-label="Previous card">
            <IconArrowUp />
          </button>
          <button className="peek-btn" onClick={() => next != null && onGo(next)} disabled={next == null} title="Next card (J)" aria-label="Next card">
            <IconArrowDown />
          </button>
          <button className="peek-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
            <IconClose />
          </button>
        </span>
      </div>

      <div className="peek-body">
        <Inline
          className="peek-title"
          label="Title"
          multiline
          enterSaves
          value={card.title}
          onSave={(v) => {
            if (v.trim()) return save({ title: v.trim() });
            toast('A card needs a title.', 'error');
            return Promise.resolve(false);
          }}
        />
        {film ? <Inline className="peek-logline" label="Logline" multiline placeholder="Add a logline" value={card.logline ?? ''} onSave={text('logline')} /> : null}

        <dl className="props">
          <Prop label="Status">
            <span className="prop-with-icon">
              <ColumnIcon column={card.column} />
              <select className="input prop-input" value={card.column} onChange={(e) => void move(e.target.value as Column)} aria-label="Status">
                {COLUMNS[card.board].map((c) => (
                  <option key={c} value={c}>
                    {COLUMN_LABELS[c]}
                  </option>
                ))}
              </select>
            </span>
          </Prop>
          <Prop label="Project">
            <span className="prop-with-icon">
              <span className="dot" style={{ background: project?.colour ?? 'transparent', boxShadow: project ? undefined : 'inset 0 0 0 1px var(--text-3)' }} />
              <select className="input prop-input" value={card.projectId ?? ''} onChange={(e) => void save({ projectId: e.target.value ? Number(e.target.value) : null })} aria-label="Project">
                <option value="">No project</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.status === 'paused' ? ' (paused)' : ''}
                  </option>
                ))}
              </select>
            </span>
          </Prop>
          {film ? (
            <>
              <Prop label="Format">
                <select className="input prop-input" value={card.format ?? ''} onChange={(e) => void save({ format: (e.target.value || null) as Card['format'] })} aria-label="Format">
                  <option value="">Not set</option>
                  {FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {capital(f)}
                    </option>
                  ))}
                </select>
              </Prop>
              <Prop label="Draft">
                <span className="prop-pair">
                  <Inline className="prop-input" label="Current draft" placeholder="Draft 3" value={card.draft ?? ''} onSave={text('draft')} />
                  <Inline className="prop-input prop-date" label="Draft date" type="date" value={card.draftDate ?? ''} onSave={(v) => save({ draftDate: v || null })} />
                </span>
              </Prop>
            </>
          ) : (
            <Prop label="Kind">
              <select className="input prop-input" value={card.kind} onChange={(e) => void save({ kind: e.target.value as Card['kind'] })} aria-label="Kind">
                <option value="feature">Feature</option>
                <option value="bug">Bug</option>
              </select>
            </Prop>
          )}
          <Prop label="Due">
            <Inline className="prop-input prop-date" label="Due" type="date" value={card.due ?? ''} onSave={(v) => save({ due: v || null })} />
          </Prop>
          {film ? (
            <Prop label="Next">
              <Inline className="prop-input" label="Next action" placeholder="The one next thing to do" value={card.nextAction ?? ''} onSave={text('nextAction')} />
            </Prop>
          ) : null}
        </dl>

        <section className="peek-section">
          <h3 className="peek-h">Notes</h3>
          <Inline className="peek-notes" label="Notes" multiline placeholder="Add notes" value={card.notes ?? ''} onSave={text('notes')} />
        </section>

        <section className="peek-section">
          <h3 className="peek-h">Links</h3>
          {card.links.length ? (
            <span className="card-links">
              {card.links.map((l) => (
                <a key={`${l.url}${l.label}`} className="link-chip" href={l.url} target="_blank" rel="noreferrer">
                  {linkLabel(l)} <IconExternal />
                </a>
              ))}
            </span>
          ) : null}
          <Inline className="peek-notes peek-links" label="Links" multiline placeholder="One per line. A label can go first: Draft 3 https://…" value={formatLinks(card.links)} onSave={(v) => save({ links: parseLinks(v) })} />
        </section>

        {film ? <Comps cardId={card.id} /> : null}
        {film ? <Submissions data={data} card={card} /> : null}

        <footer className="peek-foot">
          <span className="faint small">
            Added {formatShort(dayOf(card.createdAt))}, changed {relativeDay(dayOf(card.updatedAt), data.today)}
            {card.doneOn ? `, done ${formatShort(card.doneOn)}` : ''}
          </span>
          <button className="btn btn-quiet btn-sm peek-delete" onClick={remove}>
            <IconTrash /> Delete
          </button>
        </footer>
      </div>
    </aside>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * A field that looks like plain text until you edit it, and saves when you leave
 * it (or press Enter on one line). Escape puts back what was there. A change
 * still pending when the peek closes is saved on the way out.
 */
function Inline({
  value,
  onSave,
  label,
  className,
  placeholder,
  multiline,
  enterSaves = !multiline,
  type = 'text',
}: {
  value: string;
  onSave: (v: string) => Promise<boolean>;
  label: string;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
  /** Enter finishes the edit. On by default for one line; a wrapping title opts in. */
  enterSaves?: boolean;
  type?: 'text' | 'date';
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const cancelled = useRef(false);
  const sent = useRef<string | null>(null);
  const latest = useRef({ draft, value, onSave });
  latest.current = { draft, value, onSave };

  // Changes from elsewhere (chat, another field) show unless this one is being typed in.
  useEffect(() => {
    if (!editing.current) setDraft(value);
    sent.current = null;
  }, [value]);

  useEffect(
    () => () => {
      const l = latest.current;
      if (l.draft !== l.value && l.draft !== sent.current) void l.onSave(l.draft);
    },
    [],
  );

  const commit = async () => {
    editing.current = false;
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft === value || draft === sent.current) return;
    sent.current = draft;
    if (!(await latest.current.onSave(draft))) {
      sent.current = null;
      setDraft(latest.current.value);
    }
  };

  const props = {
    className: `inline ${className ?? ''}`,
    'aria-label': label,
    placeholder,
    value: draft,
    onFocus: () => (editing.current = true),
    onBlur: () => void commit(),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        // The first Escape leaves the field; the next one closes the peek.
        e.stopPropagation();
        setDraft(value);
        cancelled.current = true;
        e.currentTarget.blur();
      }
      if (e.key === 'Enter' && enterSaves) {
        e.preventDefault();
        e.currentTarget.blur();
      }
    },
  };
  return multiline ? (
    <textarea {...props} rows={1} onChange={(e) => setDraft(e.target.value)} />
  ) : (
    <input {...props} type={type} onChange={(e) => setDraft(e.target.value)} />
  );
}
