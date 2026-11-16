// The weekly review: what shipped, what's gone quiet, what's due back, and next week's focus.

import { useState } from 'react';
import { addDays, formatShort } from '../../../shared/dates.ts';
import { BOARD_LABELS, COLUMN_LABELS, MAX_FOCUS } from '../../../shared/work/schemas.ts';
import type { Card, WorkSnapshot } from '../../../shared/work/types.ts';
import { api } from '../../lib/api.ts';
import { href } from '../../lib/router.ts';
import { IconClock, IconInbox, IconSend, IconSpark, IconStar } from '../../ui/icons.tsx';
import { cardColour, ColumnIcon, stageColour } from './Board.tsx';
import { toast } from '../../ui/toast.tsx';
import { followUpsDue, shippedCount, shippedThisWeek, untouched } from '../../work/derive.ts';
import { workMutate } from '../../work/store.ts';
import { useNotes } from '../../notes/store.ts';

const cardLink = (c: Card) => href({ area: 'work', tab: c.board, card: c.id });

export function Review({ data }: { data: WorkSnapshot }) {
  const ideas = useNotes().data;
  const ideasWaiting = ideas ? ideas.ideas.filter((i) => i.status === 'inbox').length : null;
  const shipped = shippedThisWeek(data);
  const quiet = untouched(data);
  const due = followUpsDue(data, 7);
  const total = shippedCount(shipped);
  return (
    <div className="review">
      <section className={`review-shipped ${total ? '' : 'is-quiet'}`}>
        <p className="review-kicker">
          <IconSpark /> Week of {formatShort(shipped.from)}
        </p>
        <p className="review-big">
          <span className="num">{total}</span> shipped
        </p>
        {total ? (
          <ul className="review-list">
            {shipped.done.map((c) => (
              <li key={`d${c.id}`}>
                <a href={cardLink(c)}>{c.title}</a>
                <span className="faint small">done {formatShort(c.doneOn!)}</span>
              </li>
            ))}
            {shipped.sent.map(({ submission: s, card }) => (
              <li key={`s${s.id}`}>
                <a href={cardLink(card)}>{card.title}</a>
                <span className="faint small">
                  sent to {s.recipient}, {formatShort(s.sentOn)}
                </span>
              </li>
            ))}
            {shipped.drafts.map((c) => (
              <li key={`r${c.id}`}>
                <a href={cardLink(c)}>{c.title}</a>
                <span className="faint small">
                  {c.draft ?? 'new draft'}, {formatShort(c.draftDate!)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="faint">Nothing marked done, sent or drafted yet this week.</p>
        )}
      </section>

      <div className="review-grid">
        <section className="review-group" style={{ '--hue': '#4fd1e8' } as React.CSSProperties}>
          <GroupHead icon={<IconSend />} title="Due back" count={due.length} />
          {due.length ? (
            <ul className="review-list">
              {due.map(({ submission: s, card }) => (
                <li key={s.id}>
                  <a href={cardLink(card)}>{card.title}</a>
                  <span className="faint small">
                    {s.recipient}, follow up {s.followUpOn! <= data.today ? 'now' : formatShort(s.followUpOn!)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="faint">No follow-ups due in the next week.</p>
          )}
        </section>

        <section className="review-group" style={{ '--hue': '#ffb340' } as React.CSSProperties}>
          <GroupHead icon={<IconClock />} title="Untouched two weeks or more" count={quiet.length} />
          {quiet.length ? (
            <ul className="review-list">
              {quiet.map(({ card, days }) => (
                <li key={card.id}>
                  <a href={cardLink(card)}>{card.title}</a>
                  <span className="faint small">
                    {COLUMN_LABELS[card.column]}, {days} days
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="faint">Everything in progress has moved in the last two weeks.</p>
          )}
        </section>

        {ideasWaiting != null ? (
          <section className="review-group" style={{ '--hue': '#b69cff' } as React.CSSProperties}>
            <GroupHead icon={<IconInbox />} title="Ideas waiting" count={ideasWaiting} />
            <p className="faint">
              {ideasWaiting ? (
                <a href={href({ area: 'notes', tab: 'ideas' })}>
                  Sort {ideasWaiting === 1 ? 'it' : 'them'} in the inbox
                </a>
              ) : (
                <>
                  The inbox is empty. <a href={href({ area: 'notes', tab: 'ideas' })}>Capture one</a>
                </>
              )}
            </p>
          </section>
        ) : null}
      </div>

      <FocusPicker data={data} />
    </div>
  );
}

/** A group's heading: its mark lit in its colour, its name, and its count large at the right. */
function GroupHead({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="review-group-head">
      <span className="review-group-icon">{icon}</span>
      <h2 className="block-title">{title}</h2>
      <span className="review-group-count num">{count || ''}</span>
    </div>
  );
}

function FocusPicker({ data }: { data: WorkSnapshot }) {
  const [picked, setPicked] = useState(() => new Set(data.cards.filter((c) => c.focus).map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const candidates = data.cards.filter((c) => c.focus || !['done', 'shelved'].includes(c.column)).sort((a, b) => a.board.localeCompare(b.board) || a.position - b.position);
  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else if (n.size < MAX_FOCUS) n.add(id);
      return n;
    });
  const changed = JSON.stringify([...picked].sort()) !== JSON.stringify(data.cards.filter((c) => c.focus).map((c) => c.id).sort());
  const save = async () => {
    setBusy(true);
    try {
      await workMutate(() => api.put('/api/work/focus', [...picked]));
      toast(picked.size ? `Focus set: ${picked.size} card${picked.size === 1 ? '' : 's'}` : 'Focus cleared');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const boards = (['software', 'film'] as const).map((b) => ({ b, cards: candidates.filter((c) => c.board === b) })).filter((x) => x.cards.length);
  return (
    <section className="focus-picker">
      <div className="section-head">
        <h2>Next week's focus</h2>
        <p>
          Up to {MAX_FOCUS} cards. They show on Today. {picked.size}/{MAX_FOCUS} picked.
        </p>
      </div>
      {boards.length ? (
        <div className="focus-boards">
          {boards.map(({ b, cards }) => (
            <div key={b}>
              <h3 className="focus-board">{BOARD_LABELS[b]}</h3>
              <ul className="focus-picks">
                {cards.map((c) => (
                  <li key={c.id}>
                    <label
                      className={`focus-pick ${picked.has(c.id) ? 'on' : ''} ${!picked.has(c.id) && picked.size >= MAX_FOCUS ? 'full' : ''}`}
                      style={{ '--tint': cardColour(c, c.projectId ? projects.get(c.projectId) : undefined) ?? stageColour(c.column) } as React.CSSProperties}
                    >
                      <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} disabled={!picked.has(c.id) && picked.size >= MAX_FOCUS} />
                      <IconStar filled={picked.has(c.id)} />
                      <span className="focus-pick-title">
                        <span className="focus-pick-dot" aria-hidden="true" />
                        {c.title}
                      </span>
                      <span className="focus-pick-col small">
                        <ColumnIcon column={c.column} />
                        {COLUMN_LABELS[c.column]}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="faint">No cards in progress to pick from yet.</p>
      )}
      <div className="focus-actions">
        <button className="btn btn-primary" onClick={save} disabled={!changed || busy}>
          Save focus
        </button>
        {data.today < addDays(shippedThisWeek(data).from, 5) ? null : <span className="faint small">Picked for the week starting {formatShort(addDays(shippedThisWeek(data).from, 7))}.</span>}
      </div>
    </section>
  );
}
