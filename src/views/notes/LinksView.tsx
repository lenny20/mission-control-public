// Saved links: a web address with an optional title, note and project.

import { useState } from 'react';
import type { NotesSnapshot, SavedLink } from '../../../shared/docs/types.ts';
import { api } from '../../lib/api.ts';
import { notesMutate } from '../../notes/store.ts';
import { IconExternal, IconLink, IconTrash } from '../../ui/icons.tsx';
import { toast } from '../../ui/toast.tsx';
import { ifConfirmed } from '../../ui/confirm.tsx';
import { linkLabel } from '../../work/derive.ts';

export function LinksView({ data }: { data: NotesSnapshot }) {
  const [form, setForm] = useState({ url: '', title: '', project: '', note: '' });
  const [filter, setFilter] = useState('');
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await notesMutate(() => api.post('/api/links', { url: form.url, title: form.title || null, project: form.project || null, note: form.note || null }));
      setForm({ url: '', title: '', project: form.project, note: '' });
      toast('Link saved');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const list = data.links.filter((l) => words.every((w) => [l.url, l.title, l.note, l.project].some((f) => f?.toLowerCase().includes(w))));
  return (
    <div className="links">
      {/* Paste an address; the rest asks only once there's something to save. */}
      <form className={`link-add ${form.url.trim() ? 'open' : ''}`} onSubmit={add}>
        <div className="link-add-row">
          <label className="quick-field link-url-field">
            <IconLink />
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Paste a link to keep" aria-label="Web address" required />
          </label>
          <button className="btn btn-primary" disabled={!form.url.trim()}>
            Save link
          </button>
        </div>
        {form.url.trim() ? (
          <div className="link-add-more">
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (optional)" aria-label="Title" />
            <input className="input" list="link-projects" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} placeholder="Project (optional)" aria-label="Project" />
            <datalist id="link-projects">
              {data.projects.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <input className="input link-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Why it's worth keeping (optional)" aria-label="Note" />
          </div>
        ) : null}
      </form>
      {data.links.length > 6 ? <input className="input links-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter links" aria-label="Filter links" /> : null}
      <ul className="link-list">
        {list.map((l) => (
          <LinkRow key={l.id} l={l} />
        ))}
      </ul>
      {!data.links.length ? (
        <div className="blank">
          <span className="blank-icon" aria-hidden="true">
            <IconLink />
          </span>
          <h3 className="blank-title">No links kept yet</h3>
          <p className="blank-text">Paste an address above to keep it with a note on why it matters, or send it to Claude.</p>
        </div>
      ) : null}
    </div>
  );
}

/** The site a link is on, without "www.". */
function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function LinkRow({ l }: { l: SavedLink }) {
  const site = siteOf(l.url);
  // Each site gets its own steady hue for its tile, so the same site always looks the same.
  let hue = 0;
  for (const ch of site) hue = (hue * 31 + ch.codePointAt(0)!) % 360;
  return (
    <li className="link-row">
      <span className="link-tile" style={{ '--hue': hue } as React.CSSProperties} aria-hidden="true">
        {site.replace(/^[^a-z0-9]+/i, '')[0]?.toUpperCase() ?? '?'}
      </span>
      <div className="link-body">
        <a className="link-main" href={l.url} target="_blank" rel="noreferrer">
          <span className="link-title">
            {l.title ?? linkLabel({ label: null, url: l.url })} <IconExternal />
          </span>
          <span className="link-url">{site}</span>
        </a>
        {l.note ? <p className="link-note-text">{l.note}</p> : null}
      </div>
      <div className="link-meta">
        {l.project ? <span className="chip">{l.project}</span> : null}
        <button className="link-delete" onClick={() => ifConfirmed({ title: 'Delete this link?' }, () => notesMutate(() => api.del(`/api/links/${l.id}`)).catch((e: Error) => toast(e.message, 'error')))} aria-label="Delete this link" title="Delete">
          <IconTrash />
        </button>
      </div>
    </li>
  );
}
