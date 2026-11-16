// Any readable document on the computer, shown cleanly: markdown as a page,
// scripts as a screenplay, Word as paragraphs, PDFs in the browser's viewer.

import { useEffect, useState } from 'react';
import { KIND_LABELS, type DocView } from '../../../shared/docs/types.ts';
import { api } from '../../lib/api.ts';
import { Markdown, splitFrontMatter } from '../../notes/Markdown.tsx';
import { Script } from '../../notes/Script.tsx';
import { IconChevronLeft } from '../../ui/icons.tsx';
import { toast } from '../../ui/toast.tsx';

export function DocViewer({ path }: { path: string }) {
  const [doc, setDoc] = useState<DocView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDoc(null);
    setError(null);
    api
      .get<DocView>(`/api/docs/view?path=${encodeURIComponent(path)}`)
      .then(setDoc)
      .catch((e: Error) => setError(e.message));
  }, [path]);

  const back = (
    <button className="link-btn viewer-back" onClick={() => history.back()}>
      <IconChevronLeft /> Back
    </button>
  );
  if (error)
    return (
      <div className="viewer">
        {back}
        <div className="empty">
          <strong>Can't open this file.</strong>
          {error}
        </div>
      </div>
    );
  if (!doc) return <div className="loading" aria-busy="true" />;

  const folder = doc.path.slice(0, doc.path.length - doc.name.length - 1);
  const c = doc.content;
  const fm = c.type === 'markdown' ? splitFrontMatter(c.text) : null;
  return (
    <div className={`viewer viewer-${c.type}`}>
      {back}
      <header className="viewer-head">
        <h1 className="viewer-name">{doc.name}</h1>
        <p className="faint small viewer-meta">
          {KIND_LABELS[doc.kind].replace(/s$/, '')}, changed {new Date(doc.modified).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}{' '}
          <button
            className="link-btn"
            onClick={() =>
              void navigator.clipboard
                .writeText(doc.path)
                .then(() => toast('Path copied'))
                .catch(() => toast(doc.path))
            }
            title="Copy the full path"
          >
            {doc.display}
          </button>
        </p>
        {fm?.meta.length ? (
          <dl className="viewer-fm">
            {fm.meta.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </header>
      {c.type === 'markdown' ? (
        <Markdown text={fm!.body} base={folder} />
      ) : c.type === 'script' ? (
        <Script title={c.title} lines={c.lines} />
      ) : c.type === 'word' ? (
        <article className="prose">
          {c.paragraphs.map((p, i) =>
            /^Heading1|^Title/.test(p.style ?? '') ? <h1 key={i}>{p.text}</h1> : /^Heading/.test(p.style ?? '') ? <h2 key={i}>{p.text}</h2> : <p key={i}>{p.text || ' '}</p>,
          )}
        </article>
      ) : c.type === 'pdf' ? (
        <iframe className="viewer-pdf" src={`/api/docs/raw?path=${encodeURIComponent(doc.path)}`} title={doc.name} />
      ) : (
        <pre className="viewer-text">{c.text}</pre>
      )}
    </div>
  );
}
