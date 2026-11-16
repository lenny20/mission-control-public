// The card drawer: new cards and edits, and a film project's submissions.

import { useMemo, useState } from 'react';
import { addDays, daysBetween, formatShort } from '../../shared/dates.ts';
import { BOARD_LABELS, COLUMN_LABELS, COLUMNS, FOLLOW_UP_DAYS, FORMATS, MAX_FOCUS, type Board, type Column } from '../../shared/work/schemas.ts';
import type { Card, Submission, WorkSnapshot } from '../../shared/work/types.ts';
import { api } from '../lib/api.ts';
import { Segmented } from '../ui/fields.tsx';
import { IconExternal } from '../ui/icons.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { toast } from '../ui/toast.tsx';
import { confirmAction, ifConfirmed } from '../ui/confirm.tsx';
import { dayOf, formatLinks, linkLabel, parseLinks } from './derive.ts';
import { workMutate } from './store.ts';
import { useWatch } from '../watch/store.ts';

/** A new card starts in the given column and, when the board is filtered to one, that project. */
export type CardEditor = { cardId: number } | { draft: { board: Board; column?: Column; projectId?: number | null } };

type Draft = {
  title: string;
  column: Column;
  notes: string;
  links: string;
  due: string;
  focus: boolean;
  logline: string;
  format: string;
  draft: string;
  draftDate: string;
  nextAction: string;
  projectId: string;
  kind: 'feature' | 'bug';
};

function fromCard(c: Card): Draft {
  return {
    title: c.title,
    column: c.column,
    notes: c.notes ?? '',
    links: formatLinks(c.links),
    due: c.due ?? '',
    focus: c.focus,
    logline: c.logline ?? '',
    format: c.format ?? '',
    draft: c.draft ?? '',
    draftDate: c.draftDate ?? '',
    nextAction: c.nextAction ?? '',
    projectId: c.projectId ? String(c.projectId) : '',
    kind: c.kind,
  };
}

/** Draft fields as the API wants them, for one board. */
function toFields(d: Draft, board: Board) {
  const blank = (v: string) => (v.trim() ? v.trim() : null);
  const common = { title: d.title, notes: blank(d.notes), links: parseLinks(d.links), due: d.due || null, focus: d.focus && d.column !== 'done', projectId: d.projectId ? Number(d.projectId) : null };
  return board === 'film'
    ? { ...common, logline: blank(d.logline), format: d.format || null, draft: blank(d.draft), draftDate: d.draftDate || null, nextAction: blank(d.nextAction) }
    : { ...common, kind: d.kind };
}

export function CardSheet({ data, editor, onClose }: { data: WorkSnapshot; editor: CardEditor; onClose: () => void }) {
  const card = 'cardId' in editor ? data.cards.find((c) => c.id === editor.cardId) : undefined;
  const board: Board = card?.board ?? ('draft' in editor ? editor.draft.board : 'software');
  const initial = useMemo<Draft>(
    () =>
      card
        ? fromCard(card)
        : {
            title: '',
            column: ('draft' in editor && editor.draft.column) || COLUMNS[board][0],
            notes: '',
            links: '',
            due: '',
            focus: false,
            logline: '',
            format: '',
            draft: '',
            draftDate: '',
            nextAction: '',
            projectId: ('draft' in editor && editor.draft.projectId && String(editor.draft.projectId)) || '',
            kind: 'feature',
          },
    // Fixed when the drawer opens: a refresh mid-edit must not reset what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  if ('cardId' in editor && !card) {
    return (
      <Sheet title="Card not found" onClose={onClose}>
        <p className="muted">Card {editor.cardId} isn't on the boards any more. It may have been deleted.</p>
      </Sheet>
    );
  }

  const focusTaken = data.cards.filter((c) => c.focus && c.id !== card?.id).length >= MAX_FOCUS;
  const projects = data.projects;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const fields = toFields(draft, board);
      if (!card) {
        await workMutate(() => api.post('/api/work/cards', { board, column: draft.column, ...fields }));
        toast('Card added');
      } else {
        // Only what changed, so an edit made from chat meanwhile isn't overwritten.
        const before = toFields(initial, board) as Record<string, unknown>;
        const patch = Object.fromEntries(Object.entries(fields).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
        // Move first: a card coming out of Done can only be put in focus once it's out.
        await workMutate(async () => {
          if (draft.column !== initial.column) await api.post(`/api/work/cards/${card.id}/move`, { column: draft.column });
          if (Object.keys(patch).length) await api.put(`/api/work/cards/${card.id}`, patch);
        });
        toast('Card saved');
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!card || !(await confirmAction({ title: `Delete “${card.title}”?`, body: "This can't be undone." }))) return;
    setBusy(true);
    try {
      await workMutate(() => api.del(`/api/work/cards/${card.id}`));
      toast('Card deleted');
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const project = projects.find((p) => String(p.id) === draft.projectId);

  return (
    <Sheet
      title={card ? 'Edit card' : 'New card'}
      subtitle={
        <span className="card-where">
          {project ? <span className="dot" style={{ background: project.colour }} /> : null}
          {BOARD_LABELS[board]}
          {card ? `, added ${formatShort(dayOf(card.createdAt))}` : ''}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          {card ? (
            <button className="btn btn-danger" type="button" onClick={remove} disabled={busy}>
              Delete
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn btn-quiet" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" form="card-form" disabled={busy}>
            {card ? 'Save' : 'Add card'}
          </button>
        </>
      }
    >
      <form id="card-form" className="card-form" onSubmit={save}>
        <label className="field ev-title-field">
          <span className="visually-hidden">Title</span>
          <input className="ev-title-input" placeholder={board === 'film' ? 'Project title' : 'What needs doing?'} value={draft.title} onChange={(e) => set({ title: e.target.value })} autoFocus={!card} required />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Column</span>
            <select className="input" value={draft.column} onChange={(e) => set({ column: e.target.value as Column })}>
              {COLUMNS[board].map((c) => (
                <option key={c} value={c}>
                  {COLUMN_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Project</span>
            <select className="input" value={draft.projectId} onChange={(e) => set({ projectId: e.target.value })}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.status === 'paused' ? ' (paused)' : ''}
                </option>
              ))}
            </select>
          </label>
          {board === 'software' ? null : (
            <label className="field">
              <span>Format</span>
              <select className="input" value={draft.format} onChange={(e) => set({ format: e.target.value })}>
                <option value="">Not set</option>
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f[0]!.toUpperCase() + f.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {board === 'software' ? (
          <div className="field">
            <span>Kind</span>
            <Segmented
              label="Kind"
              value={draft.kind}
              onChange={(kind) => set({ kind })}
              options={[
                { value: 'feature', label: 'Feature' },
                { value: 'bug', label: 'Bug' },
              ]}
            />
          </div>
        ) : (
          <>
            <label className="field">
              <span>Logline</span>
              <textarea rows={2} value={draft.logline} onChange={(e) => set({ logline: e.target.value })} placeholder="The story in a sentence" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Current draft</span>
                <input className="input" value={draft.draft} onChange={(e) => set({ draft: e.target.value })} placeholder="Draft 3" />
              </label>
              <label className="field">
                <span>Draft date</span>
                <input className="input" type="date" value={draft.draftDate} onChange={(e) => set({ draftDate: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Next action</span>
              <input className="input" value={draft.nextAction} onChange={(e) => set({ nextAction: e.target.value })} placeholder="The one next thing to do" />
            </label>
          </>
        )}

        <div className="field-row">
          <label className="field">
            <span>Due</span>
            <input className="input" type="date" value={draft.due} onChange={(e) => set({ due: e.target.value })} />
            <small>Only for real deadlines. They show on the calendar.</small>
          </label>
          <label className={`check card-focus ${focusTaken && !draft.focus ? 'disabled' : ''}`}>
            <input type="checkbox" checked={draft.focus} disabled={(focusTaken && !draft.focus) || draft.column === 'done'} onChange={(e) => set({ focus: e.target.checked })} />
            <span>
              In focus
              <small className="faint">{focusTaken && !draft.focus ? `${MAX_FOCUS} cards are already in focus.` : 'Shows on Today.'}</small>
            </span>
          </label>
        </div>

        <label className="field">
          <span>Notes</span>
          <textarea rows={4} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        <label className="field">
          <span>Links</span>
          <textarea rows={2} value={draft.links} onChange={(e) => set({ links: e.target.value })} placeholder="One per line. A label can go first: Draft 3 https://…" />
          {card?.links.length ? (
            <span className="card-links">
              {card.links.map((l) => (
                <a key={`${l.url}${l.label}`} className="link-btn" href={l.url} target="_blank" rel="noreferrer">
                  {linkLabel(l)} <IconExternal />
                </a>
              ))}
            </span>
          ) : null}
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {card?.board === 'film' ? <Comps cardId={card.id} /> : null}
      {card?.board === 'film' ? <Submissions data={data} card={card} /> : null}
    </Sheet>
  );
}

// ------------------------------------------------------------------ comparison titles

/** Watchlist titles tagged as comparisons for this project. They're tagged from the Watchlist. */
export function Comps({ cardId }: { cardId: number }) {
  const items = (useWatch().data?.items ?? []).filter((w) => w.comps.includes(cardId));
  return (
    <section className="subs" aria-labelledby="comps-title">
      <div className="block-head">
        <h3 id="comps-title" className="block-title">
          Comparison titles
        </h3>
        <a className="link-btn" href="#/watch/to-watch">
          Watchlist
        </a>
      </div>
      {items.length ? (
        <ul className="comp-list">
          {items.map((w) => (
            <li key={w.id}>
              <a href={`#/watch/${w.status}/${w.id}`}>
                {w.title}
                {w.year ? <span className="faint"> ({w.year})</span> : null}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="faint small">None yet. Open a title on the Watchlist and tick this project.</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ submissions

export function Submissions({ data, card }: { data: WorkSnapshot; card: Card }) {
  const list = data.submissions.filter((s) => s.cardId === card.id);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ recipient: '', sentOn: data.today, followUpOn: addDays(data.today, FOLLOW_UP_DAYS) });
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    try {
      await workMutate(() => api.post(`/api/work/cards/${card.id}/submissions`, { recipient: form.recipient, sentOn: form.sentOn, followUpOn: form.followUpOn || null }));
      toast(`Logged: sent to ${form.recipient}`);
      setAdding(false);
      setForm({ recipient: '', sentOn: data.today, followUpOn: addDays(data.today, FOLLOW_UP_DAYS) });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="subs" aria-labelledby="subs-title">
      <div className="block-head">
        <h3 id="subs-title" className="block-title">
          Submissions
        </h3>
        {!adding ? (
          <button className="link-btn" type="button" onClick={() => setAdding(true)}>
            Log a submission
          </button>
        ) : null}
      </div>
      {list.length ? (
        <ol className="subs-list">
          {[...list].reverse().map((s) => (
            <SubmissionRow key={s.id} s={s} today={data.today} />
          ))}
        </ol>
      ) : !adding ? (
        <p className="faint small">Not sent anywhere yet.</p>
      ) : null}
      {adding ? (
        <div className="subs-add">
          <label className="field">
            <span>Sent to</span>
            <input className="input" value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} placeholder="Screen Australia" autoFocus />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Sent</span>
              <input className="input" type="date" value={form.sentOn} onChange={(e) => setForm({ ...form, sentOn: e.target.value, followUpOn: e.target.value ? addDays(e.target.value, FOLLOW_UP_DAYS) : form.followUpOn })} />
            </label>
            <label className="field">
              <span>Follow up</span>
              <input className="input" type="date" value={form.followUpOn} onChange={(e) => setForm({ ...form, followUpOn: e.target.value })} />
            </label>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="subs-actions">
            <button className="btn btn-quiet btn-sm" type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn btn-sm" type="button" onClick={add} disabled={!form.recipient.trim()}>
              Log it
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SubmissionRow({ s, today }: { s: Submission; today: string }) {
  const [responding, setResponding] = useState(false);
  const [response, setResponse] = useState('');
  const out = !s.response;
  const days = daysBetween(s.sentOn, out ? today : s.respondedOn ?? today);
  const due = out && s.followUpOn && s.followUpOn <= today;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await workMutate(fn);
      toast(done);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <li className={`sub ${out ? 'out' : ''}`}>
      <div className="sub-main">
        <strong>{s.recipient}</strong>
        <span className="faint small">
          Sent {formatShort(s.sentOn)}
          {out ? `, out ${days} day${days === 1 ? '' : 's'}` : `, answered after ${days} day${days === 1 ? '' : 's'}`}
        </span>
      </div>
      {out ? (
        <div className="sub-side">
          {s.followUpOn ? <span className={`chip ${due ? 'chip-due' : ''}`}>{due ? 'Follow up now' : `Follow up ${formatShort(s.followUpOn)}`}</span> : null}
          {!responding ? (
            <button className="link-btn" type="button" onClick={() => setResponding(true)}>
              Record response
            </button>
          ) : null}
        </div>
      ) : (
        <div className="sub-side">
          <span className="sub-response">{s.response}</span>
        </div>
      )}
      {responding ? (
        <form
          className="sub-respond"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.put(`/api/work/submissions/${s.id}`, { response }), 'Response recorded');
          }}
        >
          <input className="input" list="responses" value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Passed, wants a meeting…" autoFocus />
          <datalist id="responses">
            <option value="Passed" />
            <option value="Wants to read more" />
            <option value="Wants a meeting" />
            <option value="Optioned" />
          </datalist>
          <button className="btn btn-sm" disabled={!response.trim()}>
            Save
          </button>
          <button className="btn btn-quiet btn-sm" type="button" onClick={() => setResponding(false)}>
            Cancel
          </button>
        </form>
      ) : null}
      <button
        className="sub-delete link-btn faint"
        type="button"
        onClick={() => ifConfirmed({ title: `Delete the submission to ${s.recipient}?` }, () => run(() => api.del(`/api/work/submissions/${s.id}`), 'Submission deleted'))}
      >
        Delete
      </button>
    </li>
  );
}
