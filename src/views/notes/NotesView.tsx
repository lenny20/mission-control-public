// Notes: markdown files in the notes folder, with a list on the left and the
// note on the right, shown as a page or edited as text.

import { useEffect, useMemo, useState } from 'react';
import { relativeDay } from '../../../shared/dates.ts';
import type { Note, NotesSnapshot } from '../../../shared/docs/types.ts';
import { api } from '../../lib/api.ts';
import { navigate, setLeaveGuard } from '../../lib/router.ts';
import { Markdown } from '../../notes/Markdown.tsx';
import { notesMutate } from '../../notes/store.ts';
import { IconFolder, IconNotes, IconPlus } from '../../ui/icons.tsx';
import { toast } from '../../ui/toast.tsx';
import { confirmAction } from '../../ui/confirm.tsx';
import { dayOf } from '../../work/derive.ts';

const open = (file?: string) => navigate({ area: 'notes', tab: 'notes', param: file });

export function NotesView({ data, file }: { data: NotesSnapshot; file?: string }) {
  const [filter, setFilter] = useState('');
  const [project, setProject] = useState('');
  const list = data.notes.filter(
    (n) => (!project || n.project === project) && (!filter || `${n.title} ${n.excerpt} ${n.project ?? ''}`.toLowerCase().includes(filter.toLowerCase())),
  );
  const usedProjects = [...new Set(data.notes.map((n) => n.project).filter((p): p is string => !!p))].sort();
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      let title = 'Untitled';
      for (let n = 2; data.notes.some((x) => x.title === title); n++) title = `Untitled ${n}`;
      const note = await notesMutate(() => api.post<Note>('/api/note', { title, body: '', project: project || null }));
      open(note.file);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="notes-layout">
      <aside className="notes-side">
        <div className="notes-tools">
          <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter notes" aria-label="Filter notes" />
          <button className="btn btn-primary icon-btn" onClick={create} disabled={creating} aria-label="New note" title="New note">
            <IconPlus />
          </button>
        </div>
        {usedProjects.length ? (
          <select className="input input-sm" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {usedProjects.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        ) : null}
        <ul className="note-list">
          {list.map((n) => (
            <li key={n.file}>
              <a className={`note-item ${n.file === file ? 'on' : ''}`} href={`#/notes/notes/${encodeURIComponent(n.file)}`}>
                <span className="note-item-title">{n.title}</span>
                <span className="note-item-excerpt">{n.excerpt || 'Empty'}</span>
                <span className="faint small">
                  {n.project ? `${n.project}, ` : ''}
                  {relativeDay(dayOf(n.modified), data.today)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </aside>
      <section className="notes-main">
        {file ? (
          <NoteEditor key={file} file={file} data={data} />
        ) : (
          <div className="blank notes-blank">
            <span className="blank-icon" aria-hidden="true">
              <IconNotes />
            </span>
            <h3 className="blank-title">{data.notes.length ? 'Pick a note' : 'Start your first note'}</h3>
            <p className="blank-text">
              {data.notes.length ? 'Choose one from the list, or start a new one.' : `Each note is a markdown file in ${data.notesDir.replace(/^\/home\/[^/]+/, '~')}, so it opens in any editor too.`}
            </p>
            <button className="btn btn-primary" onClick={create} disabled={creating}>
              <IconPlus /> New note
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function NoteEditor({ file, data }: { file: string; data: NotesSnapshot }) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', project: '', body: '' });
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Note>(`/api/note?f=${encodeURIComponent(file)}`)
      .then((n) => {
        setNote(n);
        setDraft({ title: n.title, project: n.project ?? '', body: n.body });
        if (!n.body.trim()) setMode('edit');
      })
      .catch((e: Error) => setError(e.message));
  }, [file]);

  const dirty = !!note && (draft.title !== note.title || draft.project !== (note.project ?? '') || draft.body !== note.body);
  // Leaving with unsaved changes asks first: closing the tab, or moving anywhere in the dashboard.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    const release = setLeaveGuard(() => window.confirm(`"${draft.title}" has unsaved changes. Leave without saving them?`));
    return () => {
      window.removeEventListener('beforeunload', warn);
      release();
    };
  }, [dirty, draft.title]);

  const save = async () => {
    if (!note || !dirty || busy) return;
    setBusy(true);
    try {
      const patch: Record<string, unknown> = { baseModified: note.modified };
      if (draft.title !== note.title) patch.title = draft.title;
      if (draft.project !== (note.project ?? '')) patch.project = draft.project || null;
      if (draft.body !== note.body) patch.body = draft.body;
      const saved = await notesMutate(() => api.put<Note>(`/api/note?f=${encodeURIComponent(note.file)}`, patch));
      setNote(saved);
      setDraft({ title: saved.title, project: saved.project ?? '', body: saved.body });
      toast('Note saved');
      // Saved, so moving to the renamed file needs no question.
      if (saved.file !== note.file) setTimeout(() => open(saved.file));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!note || !(await confirmAction({ title: `Delete “${note.title}”?`, body: 'It moves to the .trash folder inside your notes folder.' }))) return;
    try {
      await notesMutate(() => api.del(`/api/note?f=${encodeURIComponent(note.file)}`));
      toast('Note moved to the trash folder');
      open();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const projects = useMemo(() => data.projects, [data.projects]);
  if (error) return <div className="empty">{error}</div>;
  if (!note) return <div className="loading" aria-busy="true" />;

  return (
    <div
      className="note-editor"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          void save();
        }
      }}
    >
      <div className="note-bar">
        <input className="input input-sm note-project" list="note-projects" value={draft.project} onChange={(e) => setDraft({ ...draft, project: e.target.value })} placeholder="No project" aria-label="Project" />
        <datalist id="note-projects">
          {projects.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <div className="segmented" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === 'read'} onClick={() => setMode('read')}>
            Read
          </button>
          <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>
            Edit
          </button>
        </div>
        <span className="spacer" />
        <button className="btn btn-quiet btn-sm note-delete" onClick={remove}>
          Delete
        </button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || busy} title="Save (Ctrl+S)">
          {dirty ? 'Save' : 'Saved'}
        </button>
      </div>
      <div className="note-page">
        <input className="note-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Title" />
        {mode === 'edit' ? (
          <textarea className="note-body" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Write in markdown. # for a heading, - for a list, **bold**." aria-label="Note" autoFocus />
        ) : (
          <div className="note-read" onDoubleClick={() => setMode('edit')}>
            {draft.body.trim() ? <Markdown text={draft.body} /> : <p className="faint">Empty. Double-click or press Edit to write.</p>}
          </div>
        )}
      </div>
      <p className="note-file" title={`${data.notesDir}/${note.file}`}>
        <IconFolder /> {data.notesDir.replace(/^\/home\/[^/]+/, '~')}/{note.file}
      </p>
    </div>
  );
}
