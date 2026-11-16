import { useEffect, useSyncExternalStore } from 'react';
import { href, navigate, NOTES_TABS, type NotesTab } from '../../lib/router.ts';
import { useKey } from '../../lib/hooks.ts';
import { useNotes } from '../../notes/store.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { DocsView } from './DocsView.tsx';
import { DocViewer } from './DocViewer.tsx';
import { CaptureBox, IdeasView } from './IdeasView.tsx';
import { LinksView } from './LinksView.tsx';
import { NotesView } from './NotesView.tsx';

const LABELS: Record<(typeof NOTES_TABS)[number], string> = { ideas: 'Ideas', notes: 'Notes', links: 'Links', docs: 'Search' };

export function NotesArea({ tab, param, watchReady }: { tab: NotesTab; param?: string; watchReady: boolean }) {
  const { data, error } = useNotes();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.sheet')) return;
      const next = NOTES_TABS[Number(e.key) - 1];
      if (next) navigate({ area: 'notes', tab: next });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const inbox = data?.ideas.filter((i) => i.status === 'inbox').length ?? 0;

  if (tab === 'view') return <div className="page">{param ? <DocViewer path={param} /> : null}</div>;
  return (
    <div className="page notes-page">
      <header className="page-head">
        <h1 className="page-title">Notes</h1>
        <nav className="tabs" aria-label="Notes sections">
          {NOTES_TABS.map((t, i) => (
            <a key={t} className="tab" href={href({ area: 'notes', tab: t })} aria-current={t === tab ? 'page' : undefined} title={`Press ${i + 1}`}>
              {LABELS[t]}
              {t === 'ideas' && inbox ? <span className="tab-count num">{inbox}</span> : null}
            </a>
          ))}
        </nav>
      </header>
      {tab === 'docs' ? (
        <DocsView />
      ) : error && !data ? (
        <div className="empty">
          <strong>Notes couldn't load.</strong>
          {error}
        </div>
      ) : !data ? (
        <div className="loading" aria-busy="true" />
      ) : tab === 'ideas' ? (
        <IdeasView data={data} watchReady={watchReady} />
      ) : tab === 'notes' ? (
        <NotesView data={data} file={param} />
      ) : (
        <LinksView data={data} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ capture anywhere

let captureOpen = false;
const subs = new Set<() => void>();
const setCapture = (v: boolean) => {
  captureOpen = v;
  subs.forEach((s) => s());
};
export const openCapture = () => setCapture(true);

/** Press I anywhere to capture an idea without leaving the screen. */
export function CaptureHost() {
  const open = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => captureOpen,
  );
  useKey('i', (e) => {
    if (document.querySelector('.sheet')) return;
    e.preventDefault();
    setCapture(true);
  });
  if (!open) return null;
  return (
    <Sheet title="Capture an idea" subtitle="It goes to the Ideas inbox, to sort later." onClose={() => setCapture(false)}>
      <CaptureBox autoFocus onDone={() => setCapture(false)} />
    </Sheet>
  );
}
