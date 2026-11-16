// Doc search: file names and contents across the places in settings, with
// the newest markdown files when nothing is typed.

import { useEffect, useRef, useState } from 'react';
import { useRequest } from '../../lib/commands.ts';
import { DOC_KINDS, KIND_LABELS, type DocFile, type DocKind, type IndexStatus, type SavedLink, type SearchHit } from '../../../shared/docs/types.ts';
import { api } from '../../lib/api.ts';
import { useKey } from '../../lib/hooks.ts';
import { href } from '../../lib/router.ts';
import { onServerChange } from '../../lib/store.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { IconSearch } from '../../ui/icons.tsx';
import { toast } from '../../ui/toast.tsx';
import type { VaultDoc } from '../../../shared/money/types.ts';
import { dayOf } from '../../work/derive.ts';
import { daysBetween, formatLong } from '../../../shared/dates.ts';

const viewHref = (p: string) => href({ area: 'notes', tab: 'view', param: p });

/** Each kind of file has a colour of its own, used for its mark and its filter. */
const KIND_HUE: Record<DocKind, string> = { markdown: '#5aa9ff', text: '#a3abc8', pdf: '#ff6b5e', word: '#7c8cff', script: '#e8c27a' };

/** A file's mark: a small page in its kind's colour, with its extension on it. */
function FileMark({ name, kind }: { name: string; kind: DocKind }) {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.slice(0, 4) ?? '';
  return (
    <span className="file-mark" style={{ '--hue': KIND_HUE[kind] } as React.CSSProperties} aria-hidden="true">
      {ext}
    </span>
  );
}

/** The folder a file sits in, split into the project (the first folder) and the rest. */
function folderOf(display: string, name: string): { project: string; rest: string } {
  const dir = display.slice(0, -name.length - 1).replace(/^~\/projects\//, '');
  const [project = '', ...rest] = dir.split('/');
  return { project, rest: rest.join('/') };
}

/** A steady colour for a folder name, so the same project always reads the same. */
function folderHue(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `oklch(0.74 0.12 ${h})`;
}

/** "…the \u0002quick\u0003 fox" with the matches marked. */
export function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\u0002[^\u0003]*\u0003)/).map((part, i) =>
        part.startsWith('\u0002') ? <mark key={i}>{part.slice(1, -1)}</mark> : <span key={i}>{part.replace(/\s+/g, ' ')}</span>,
      )}
    </>
  );
}

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
};

export function DocsView() {
  const [q, setQ] = useState(() => sessionQuery);
  const [kind, setKind] = useState<DocKind | null>(null);
  const [result, setResult] = useState<{ q: string; hits: SearchHit[]; links: SavedLink[]; vault: VaultDoc[] } | null>(null);
  const [recentDocs, setRecent] = useState<DocFile[] | null>(null);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [placesOpen, setPlacesOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // "Search documents for …" from the command palette.
  useRequest('docs', (query) => {
    setQ(query);
    input.current?.focus();
  });

  useKey('/', (e) => {
    if (document.querySelector('.sheet')) return;
    e.preventDefault();
    input.current?.focus();
  });

  const loadStatus = () => void api.get<IndexStatus>('/api/docs/status').then(setStatus).catch(() => {});
  useEffect(() => {
    loadStatus();
    void api.get<DocFile[]>('/api/docs/recent').then(setRecent).catch(() => {});
    const t = setInterval(loadStatus, 10_000);
    const off = onServerChange(loadStatus);
    return () => {
      clearInterval(t);
      off();
    };
  }, []);

  useEffect(() => {
    sessionQuery = q;
    if (!q.trim()) {
      setResult(null);
      return;
    }
    const t = setTimeout(() => {
      void api
        .get<{ hits: SearchHit[]; links: SavedLink[]; vault: VaultDoc[] }>(`/api/docs/search?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}`)
        .then((r) => setResult({ q, ...r }))
        .catch((e: Error) => toast(e.message, 'error'));
    }, 120);
    return () => clearTimeout(t);
  }, [q, kind]);

  return (
    <div className="docs">
      <div className="docs-search">
        <label className="docs-field">
          <IconSearch />
          <input ref={input} className="input docs-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your documents and scripts" aria-label="Search documents" autoFocus />
        </label>
        <div className="docs-kinds" role="group" aria-label="Kind">
          <button className="cal-chip" aria-pressed={kind == null} onClick={() => setKind(null)}>
            Everything
          </button>
          {DOC_KINDS.map((k) => (
            <button key={k} className="cal-chip kind-chip" style={{ '--hue': KIND_HUE[k] } as React.CSSProperties} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
              <span className="kind-dot" aria-hidden="true" />
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      {q.trim() ? (
        result ? (
          <section>
            <p className="faint small docs-count">
              {result.hits.length >= 60 ? 'The best 60 matches' : `${total(result)} match${total(result) === 1 ? '' : 'es'}`}
            </p>
            <ul className="doc-hit-list">
              {result.vault.map((v) => (
                <li key={`v${v.id}`}>
                  <a className="doc-hit" href={href({ area: 'money', tab: 'vault', id: v.id })}>
                    <span className="doc-hit-name">
                      <span className="doc-hit-kind">Tax vault</span> {v.title}
                    </span>
                    <span className="doc-hit-path faint small">
                      {v.type}, {v.country} {v.taxYear}
                      {v.issuer ? `, ${v.issuer}` : ''}
                    </span>
                  </a>
                </li>
              ))}
              {result.links.map((l) => (
                <li key={`l${l.id}`}>
                  <a className="doc-hit" href={l.url} target="_blank" rel="noreferrer">
                    <span className="doc-hit-name">
                      <span className="doc-hit-kind">Link</span> {l.title ?? l.url}
                    </span>
                    <span className="doc-hit-path faint small">{l.url}</span>
                  </a>
                </li>
              ))}
              {result.hits.map((h) => (
                <li key={h.path}>
                  <a className="doc-hit has-mark" href={viewHref(h.path)}>
                    <FileMark name={h.name} kind={h.kind} />
                    <span className="doc-hit-main">
                      <span className="doc-hit-name">{h.name}</span>
                      <span className="doc-hit-path faint small">
                        {h.display.slice(0, -h.name.length - 1)}, changed {ago(h.modified)}
                      </span>
                      {h.snippet ? (
                        <span className="doc-hit-snippet small">
                          <Snippet text={h.snippet} />
                        </span>
                      ) : null}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            {!total(result) ? <p className="faint">Nothing matches "{result.q}".</p> : null}
          </section>
        ) : null
      ) : (
        <section>
          <h2 className="block-title docs-recent-title">Recent docs</h2>
          {byDay(recentDocs ?? []).map(([day, files], i) => (
            <div key={day} className={`docs-day ${i === 0 ? 'is-latest' : ''}`}>
              <h3 className="docs-day-name">
                <span className="docs-day-dot" aria-hidden="true" />
                {day}
                <span className="docs-day-count num">{files.length}</span>
              </h3>
              <ul className="doc-hit-list recent">
                {files.map((f) => {
                  const where = folderOf(f.display, f.name);
                  return (
                    <li key={f.path}>
                      <a className="doc-hit has-mark" href={viewHref(f.path)}>
                        <FileMark name={f.name} kind={f.kind} />
                        <span className="doc-hit-name">{f.name}</span>
                        <span className="doc-hit-where">
                          {where.project ? (
                            <span className="folder-chip" style={{ '--hue': folderHue(where.project) } as React.CSSProperties} title={f.display}>
                              {where.project}
                            </span>
                          ) : null}
                          {where.rest ? <span className="doc-hit-rest faint small">{where.rest}</span> : null}
                          <span className="docs-time small">{new Date(f.modified).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}</span>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {recentDocs && !recentDocs.length ? <p className="faint">The index is still being built. Recent markdown files show here once it's done.</p> : null}
        </section>
      )}

      {status ? (
        <p className="docs-status faint small">
          {status.running ? 'Updating the index now. ' : ''}
          {status.files.toLocaleString('en-AU')} files indexed{status.lastRun ? `, checked ${ago(status.lastRun)}` : ''}.{' '}
          {status.error ? <span className="bad">Last update failed: {status.error} </span> : null}
          <button className="link-btn" onClick={() => void api.post('/api/docs/reindex').then(loadStatus)} disabled={status.running}>
            Update now
          </button>{' '}
          <button className="link-btn" onClick={() => setPlacesOpen(true)}>
            Places searched
          </button>
        </p>
      ) : null}
      {placesOpen && status ? <PlacesSheet status={status} onClose={() => setPlacesOpen(false)} onSaved={loadStatus} /> : null}
    </div>
  );
}
const total = (r: { hits: unknown[]; links: unknown[]; vault: unknown[] }) => r.hits.length + r.links.length + r.vault.length;

/** Recent files under Today, Yesterday, then weekday or date headings. */
function byDay(files: DocFile[]): [string, DocFile[]][] {
  const groups = new Map<string, DocFile[]>();
  const today = dayOf(new Date().toISOString());
  for (const f of files) {
    const d = dayOf(f.modified);
    const n = daysBetween(d, today);
    const label = n === 0 ? 'Today' : n === 1 ? 'Yesterday' : n < 7 ? formatLong(d).split(' ')[0]! : formatLong(d);
    groups.set(label, [...(groups.get(label) ?? []), f]);
  }
  return [...groups];
}

/** The last search, kept while moving between a result and the list. */
let sessionQuery = '';

function PlacesSheet({ status, onClose, onSaved }: { status: IndexStatus; onClose: () => void; onSaved: () => void }) {
  const [roots, setRoots] = useState(status.roots.join('\n'));
  const [exclude, setExclude] = useState(status.exclude.join('\n'));
  const [error, setError] = useState<string | null>(null);
  const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const save = async () => {
    try {
      await api.put('/api/docs/settings', { roots: lines(roots), exclude: lines(exclude) });
      toast('Saved. The index is updating.');
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Sheet
      title="Places searched"
      subtitle="Hidden folders, node_modules, build output and git-ignored files are always skipped."
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="card-form">
        <label className="field">
          <span>Folders</span>
          <textarea rows={6} value={roots} onChange={(e) => setRoots(e.target.value)} />
          <small>One per line. ~ on its own searches only the loose files in your home folder, not everything below it.</small>
        </label>
        <label className="field">
          <span>Skip</span>
          <textarea rows={5} value={exclude} onChange={(e) => setExclude(e.target.value)} />
          <small>Folder names skipped wherever they are, or paths from your home folder like Documents/Codex.</small>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Sheet>
  );
}
