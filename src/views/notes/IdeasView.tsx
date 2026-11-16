// The ideas inbox: capture anything, then sort each into a card, a note, the watchlist or the archive.

import { useState } from 'react';
import { relativeDay } from '../../../shared/dates.ts';
import type { Idea, NotesSnapshot } from '../../../shared/docs/types.ts';
import { api } from '../../lib/api.ts';
import { IconBoard, IconChevron, IconFilm, IconInbox, IconNotes, IconSpark, IconTrash, IconVideo } from '../../ui/icons.tsx';
import { Menu, MenuItem } from '../../ui/Menu.tsx';
import { toast } from '../../ui/toast.tsx';
import { ifConfirmed } from '../../ui/confirm.tsx';
import { notesMutate } from '../../notes/store.ts';
import { useWork } from '../../work/store.ts';
import { dayOf } from '../../work/derive.ts';

export function CaptureBox({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await notesMutate(() => api.post('/api/ideas', { text }));
      setText('');
      toast('Idea captured');
      onDone?.();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="capture"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <span className="capture-mark" aria-hidden="true">
        <IconSpark />
      </span>
      <textarea
        className="capture-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
        placeholder="An idea, a thought, a title, a thing to watch…"
        aria-label="New idea"
        rows={2}
        autoFocus={autoFocus}
      />
      <div className="capture-foot">
        <span className="capture-keys">
          <span>
            <kbd>Enter</kbd> to capture
          </span>
          <span>
            <kbd>Shift</kbd>
            <kbd>Enter</kbd> for a new line
          </span>
          <span>
            <kbd>I</kbd> from anywhere
          </span>
        </span>
        <button className="btn btn-primary btn-sm" disabled={!text.trim() || busy}>
          Capture
        </button>
      </div>
    </form>
  );
}

export function IdeasView({ data, watchReady }: { data: NotesSnapshot; watchReady: boolean }) {
  const inbox = data.ideas.filter((i) => i.status === 'inbox');
  const rest = data.ideas.filter((i) => i.status !== 'inbox');
  const [showRest, setShowRest] = useState(false);
  return (
    <div className="ideas">
      <CaptureBox autoFocus />
      <section className="section">
        <div className="section-head">
          <h2>Inbox</h2>
          {inbox.length ? <p>{inbox.length} to sort</p> : null}
        </div>
        {!inbox.length ? (
          <div className="blank">
            <span className="blank-icon" aria-hidden="true">
              <IconInbox />
            </span>
            <h3 className="blank-title">Nothing to sort</h3>
            <p className="blank-text">Every idea has a home. New ones wait here until you send each to a board, a note or the watchlist.</p>
          </div>
        ) : null}
        <ul className="idea-list">
          {inbox.map((i) => (
            <IdeaRow key={i.id} idea={i} today={data.today} watchReady={watchReady} />
          ))}
        </ul>
      </section>
      {rest.length ? (
        <section className="section">
          <button className="link-btn" onClick={() => setShowRest(!showRest)}>
            {showRest ? 'Hide' : 'Show'} sorted and archived ({rest.length})
          </button>
          {showRest ? (
            <ul className="idea-list done">
              {rest.map((i) => (
                <li key={i.id} className="idea">
                  <span className="idea-text">{i.text.split('\n')[0]}</span>
                  <span className="idea-outcome small">
                    {i.status === 'archived' ? (
                      <>
                        Archived.{' '}
                        <button className="link-btn" onClick={() => void sort(i, { to: 'inbox' }, 'Back in the inbox')}>
                          Back to inbox
                        </button>
                      </>
                    ) : (
                      <a href={i.outcomeLink ?? '#'}>Became {i.outcome}</a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

async function sort(idea: Idea, body: Record<string, unknown>, done: string) {
  try {
    const r = await notesMutate(() => api.post<Idea>(`/api/ideas/${idea.id}/sort`, body));
    toast(done, 'ok', r.outcomeLink ? { label: 'Open', run: () => (window.location.hash = r.outcomeLink!) } : undefined);
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

function IdeaRow({ idea, today, watchReady }: { idea: Idea; today: string; watchReady: boolean }) {
  const [picking, setPicking] = useState(false);
  const projects = useWork().data?.projects ?? [];
  const [project, setProject] = useState('');
  const [first, ...more] = idea.text.split('\n');
  return (
    <li className="idea">
      <div className="idea-body">
        <span className="idea-text">{first}</span>
        {more.join('\n').trim() ? <span className="idea-more">{more.join('\n').trim()}</span> : null}
      </div>
      {picking ? (
        <div className="idea-actions">
          <select className="input input-sm" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" autoFocus>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={() => void sort(idea, { to: 'card', board: 'software', projectId: project ? Number(project) : null }, 'Added to the Software backlog')}>
            Add to Backlog
          </button>
          <button className="btn btn-quiet btn-sm" onClick={() => setPicking(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="idea-actions">
          <span className="idea-age faint">{relativeDay(dayOf(idea.createdAt), today)}</span>
          <Menu
            label="Sort to"
            align="end"
            trigger={
              <>
                Sort to <IconChevron className="menu-chev" />
              </>
            }
          >
            {(close) => (
              <>
                <MenuItem onSelect={() => (close(), void sort(idea, { to: 'card', board: 'film' }, 'Added to Film & TV ideas'))}>
                  <IconFilm className="menu-icon" /> A Film & TV idea
                </MenuItem>
                <MenuItem onSelect={() => (close(), setPicking(true))}>
                  <IconBoard className="menu-icon" /> A software task…
                </MenuItem>
                <MenuItem onSelect={() => (close(), void sort(idea, { to: 'note' }, 'Made into a note'))}>
                  <IconNotes className="menu-icon" /> A note
                </MenuItem>
                {watchReady ? (
                  <MenuItem onSelect={() => (close(), void sort(idea, { to: 'watch' }, 'Added to the watchlist'))}>
                    <IconVideo className="menu-icon" /> Something to watch
                  </MenuItem>
                ) : null}
                <div className="menu-sep" role="separator" />
                <MenuItem onSelect={() => (close(), void sort(idea, { to: 'archive' }, 'Archived'))}>
                  <IconInbox className="menu-icon" /> Archive
                </MenuItem>
                <MenuItem onSelect={() => (close(), ifConfirmed({ title: 'Delete this idea?', body: 'To keep it out of the inbox without losing it, archive it instead.' }, () => notesMutate(() => api.del(`/api/ideas/${idea.id}`)).catch((e: Error) => toast(e.message, 'error'))))}>
                  <IconTrash className="menu-icon" /> Delete
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      )}
    </li>
  );
}
