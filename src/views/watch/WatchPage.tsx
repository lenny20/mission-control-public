// The Watchlist: films and series as posters, by status, with where they
// stream in Australia. TMDB fills in the details when it's set up.

import { useEffect, useState } from 'react';
import { formatShort } from '../../../shared/dates.ts';
import { STATUS_LABELS, WATCH_STATUSES } from '../../../shared/watch/schemas.ts';
import type { Scores, TmdbHit, WatchItem, WatchSnapshot } from '../../../shared/watch/types.ts';
import { api } from '../../lib/api.ts';
import { useRequest } from '../../lib/commands.ts';
import { useKey } from '../../lib/hooks.ts';
import { href, navigate, type WatchView } from '../../lib/router.ts';
import { Segmented } from '../../ui/fields.tsx';
import { IconFilm, IconPlus, IconStar } from '../../ui/icons.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/toast.tsx';
import { ifConfirmed } from '../../ui/confirm.tsx';
import { useWatch, watchMutate, watchStore } from '../../watch/store.ts';
import { useWork } from '../../work/store.ts';

export function WatchPage({ status, id }: { status: WatchView; id?: number }) {
  const { data, error } = useWatch();
  const [adding, setAdding] = useState(false);
  const [service, setService] = useState<string | null>(null);
  useKey('n', (e) => {
    if (document.querySelector('.sheet')) return;
    e.preventDefault();
    setAdding(true);
  });
  // "Add to the watchlist" from the command palette.
  useRequest('watch', () => setAdding(true));
  const items = (data?.items ?? []).filter((i) => i.status === status);
  const services = [...new Set(items.flatMap((i) => i.providers?.flatrate ?? []))].sort();
  // The service filter only applies where its chips are on screen to change it.
  const filtering = service != null && services.length > 1 && status !== 'watched' && services.includes(service);
  const shown = filtering ? items.filter((i) => i.providers?.flatrate.includes(service!)) : items;
  // On the lists still to get through, the newest addition gets the big panel and the rest follow.
  const feature = status === 'watched' ? undefined : [...shown].sort((a, b) => b.addedAt.localeCompare(a.addedAt))[0];
  // Watched reads like a diary: the latest first.
  const grid = shown.filter((i) => i !== feature).sort((a, b) => (status === 'watched' ? (b.watchedOn ?? '').localeCompare(a.watchedOn ?? '') : 0));
  const open = data && id ? data.items.find((i) => i.id === id) : undefined;

  return (
    <div className="page watch-page">
      <header className="page-head">
        <h1 className="page-title">Watchlist</h1>
        <nav className="tabs" aria-label="Status">
          {WATCH_STATUSES.map((s) => (
            <a key={s} className="tab" href={href({ area: 'watch', status: s })} aria-current={s === status ? 'page' : undefined}>
              {STATUS_LABELS[s]}
              <span className="tab-count num">{data?.items.filter((i) => i.status === s).length ?? ''}</span>
            </a>
          ))}
        </nav>
        <div className="head-actions">
          <button className="btn btn-primary" onClick={() => setAdding(true)} title="Add (N)">
            <IconPlus /> Add a title
          </button>
        </div>
      </header>
      {data && !data.tmdb ? (
        <p className="watch-note faint">
          Posters, details and where things stream in Australia arrive once a TMDB token is in <code>data/tmdb/token</code>. Until then, titles are kept as you type them.
        </p>
      ) : data && !data.omdb ? (
        <p className="watch-note faint">
          IMDb, Rotten Tomatoes and Metacritic scores arrive once an OMDb key is in <code>data/omdb/key</code>.
        </p>
      ) : null}
      {services.length > 1 && status !== 'watched' ? (
        <div className="docs-kinds watch-services" role="group" aria-label="Streaming on">
          <button className="cal-chip" aria-pressed={!filtering} onClick={() => setService(null)}>
            Anywhere
          </button>
          {services.map((s) => (
            <button key={s} className="cal-chip" aria-pressed={filtering && service === s} onClick={() => setService(filtering && service === s ? null : s)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}
      {error && !data ? (
        <div className="empty">
          <strong>The watchlist couldn't load.</strong>
          {error}
        </div>
      ) : !data ? (
        <div className="loading" aria-busy="true" />
      ) : shown.length ? (
        <>
          {feature ? <Feature item={feature} status={status} /> : null}
          {feature && grid.length ? <h2 className="watch-h">Also {status === 'watching' ? 'on the go' : 'on the list'}</h2> : null}
          <ul className="posters">
            {grid.map((i) => (
              <li key={i.id}>
                <a className="poster-card" href={href({ area: 'watch', status, id: i.id })}>
                  <Poster item={i} />
                  <span className="poster-title">{i.title}</span>
                  <span className="poster-meta faint small">
                    {[i.year, i.kind === 'tv' ? 'Series' : 'Film'].filter(Boolean).join(', ')}
                    {i.status === 'watched' && i.rating ? <Stars n={i.rating} /> : null}
                  </span>
                  {i.status === 'watched' && i.note ? <span className="poster-note">“{i.note}”</span> : null}
                  {i.status === 'watched' && i.watchedOn ? <span className="poster-on small faint">Watched {formatShort(i.watchedOn)}</span> : null}
                  {i.status !== 'watched' && i.scores ? <ScoreLine scores={i.scores} /> : null}
                  {i.status !== 'watched' && i.providers?.flatrate.length ? <span className="poster-on small">{i.providers.flatrate.slice(0, 2).join(', ')}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="blank">
          <span className="blank-icon" aria-hidden="true">
            <IconFilm />
          </span>
          <h3 className="blank-title">Nothing {status === 'watched' ? 'watched' : status === 'watching' ? 'on the go' : 'to watch'} yet</h3>
          <p className="blank-text">
            {status === 'watched'
              ? 'Mark a title watched to keep it here with your stars and one line on it.'
              : status === 'watching'
                ? 'Start something from To watch and it waits here until you finish it.'
                : 'Add a title, or send one to Claude.'}
          </p>
          {status === 'watched' || status === 'watching' ? (
            <a className="btn" href={href({ area: 'watch', status: 'to-watch' })}>
              Open To watch
            </a>
          ) : (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <IconPlus /> Add a title
            </button>
          )}
        </div>
      )}
      {adding && data ? <AddSheet data={data} onClose={() => setAdding(false)} /> : null}
      {open ? <ItemSheet key={open.id} item={open} data={data!} onClose={() => navigate({ area: 'watch', status })} /> : null}
    </div>
  );
}

/**
 * The title to watch next, large: its poster blurred into the panel behind
 * it, the details and scores beside it, and the one next step as a button.
 */
function Feature({ item, status }: { item: WatchItem; status: WatchView }) {
  const step = item.status === 'to-watch' ? { to: 'watching', label: 'Start watching', done: 'Moved to Watching' } : { to: 'watched', label: 'Mark watched', done: 'Marked watched' };
  const length = item.kind === 'tv' ? (item.seasons ? `${item.seasons} season${item.seasons === 1 ? '' : 's'}` : 'Series') : item.runtime ? `${Math.floor(item.runtime / 60)} h ${item.runtime % 60} min` : 'Film';
  const facts = [item.year, length, ...item.genres.slice(0, 2)].filter(Boolean);
  const move = async () => {
    try {
      await watchMutate(() => api.put(`/api/watch/${item.id}`, { status: step.to }));
      toast(step.done);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <section className="feature" aria-label={`Next to watch: ${item.title}`}>
      {item.poster ? <img className="feature-backdrop" src={item.poster} alt="" aria-hidden="true" /> : null}
      <a className="feature-poster" href={href({ area: 'watch', status, id: item.id })} aria-label={`${item.title}, details`}>
        <Poster item={item} big />
      </a>
      <div className="feature-body">
        <p className="feature-kicker">{item.status === 'watching' ? 'Watching' : 'Next to watch'}</p>
        <h2 className="feature-title">{item.title}</h2>
        <p className="feature-facts">{facts.join(', ')}</p>
        {item.overview ? <p className="feature-overview">{item.overview}</p> : null}
        {item.scores ? <ScoreLine scores={item.scores} /> : null}
        <div className="feature-actions">
          <button className="btn btn-primary" onClick={() => void move()}>
            {step.label}
          </button>
          <a className="btn" href={href({ area: 'watch', status, id: item.id })}>
            Details
          </a>
          {item.providers?.flatrate.length ? <span className="feature-on">On {item.providers.flatrate.slice(0, 2).join(' and ')}</span> : null}
        </div>
      </div>
    </section>
  );
}

/** A title with no poster gets a title card: its own deep colour, the name in Courier. */
function Poster({ item, big }: { item: Pick<WatchItem, 'poster' | 'title'> & { year?: number | null }; big?: boolean }) {
  if (item.poster) return <img className={`poster ${big ? 'big' : ''}`} src={item.poster} alt="" loading="lazy" />;
  let h = 0;
  for (const ch of item.title) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return (
    <span className={`poster poster-blank ${big ? 'big' : ''}`} style={{ '--card-hue': h } as React.CSSProperties} aria-hidden="true">
      <span className="poster-card-title">{item.title}</span>
      {item.year ? <span className="poster-card-year">{item.year}</span> : null}
    </span>
  );
}

/** IMDb (or TMDB's own score when IMDb has none), the Tomatometer and Metacritic, whichever exist. */
function ScoreLine({ scores, imdbId }: { scores: Scores; imdbId?: string | null }) {
  const parts = [
    scores.imdb != null ? { label: 'IMDb', value: scores.imdb.toFixed(1), title: scores.imdbVotes ? `${scores.imdbVotes.toLocaleString('en-AU')} votes` : undefined } : scores.tmdb != null ? { label: 'TMDB', value: scores.tmdb.toFixed(1) } : null,
    scores.rottenTomatoes != null ? { label: 'Rotten Tomatoes', short: 'RT', value: `${scores.rottenTomatoes}%`, cls: scores.rottenTomatoes >= 60 ? 'fresh' : 'rotten' } : null,
    scores.metacritic != null ? { label: 'Metacritic', short: 'MC', value: String(scores.metacritic) } : null,
  ].filter((p): p is NonNullable<typeof p> & { short?: string; cls?: string; title?: string } => p != null);
  if (!parts.length) return null;
  return (
    <span className={`scores small ${imdbId !== undefined ? 'long' : ''}`}>
      {parts.map((p) => (
        <span key={p.label} className={`score ${p.cls ?? ''}`} title={p.title}>
          <span className="score-src">{imdbId !== undefined ? p.label : (p.short ?? p.label)}</span> <span className="num">{p.value}</span>
        </span>
      ))}
      {imdbId ? (
        <a className="link-btn" href={`https://www.imdb.com/title/${imdbId}/`} target="_blank" rel="noreferrer">
          IMDb page
        </a>
      ) : null}
    </span>
  );
}

const Stars = ({ n }: { n: number }) => (
  <span className="stars" aria-label={`${n} out of 5`}>
    {Array.from({ length: n }, (_, i) => (
      <IconStar key={i} filled />
    ))}
  </span>
);

// ------------------------------------------------------------------ add

function AddSheet({ data, onClose }: { data: WatchSnapshot; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TmdbHit[] | null>(null);
  const [manual, setManual] = useState({ kind: 'movie' as 'movie' | 'tv', year: '' });
  useEffect(() => {
    if (!data.tmdb || q.trim().length < 2) return setHits(null);
    const t = setTimeout(() => void api.get<TmdbHit[]>(`/api/watch/search?q=${encodeURIComponent(q)}`).then(setHits).catch((e: Error) => toast(e.message, 'error')), 250);
    return () => clearTimeout(t);
  }, [q, data.tmdb]);
  const add = async (body: Record<string, unknown>) => {
    try {
      const item = await watchMutate(() => api.post<WatchItem>('/api/watch', body));
      toast(`Added ${item.title}`);
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <Sheet title="Add to the watchlist" onClose={onClose}>
      <div className="card-form">
        <input className="input docs-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={data.tmdb ? 'Search films and series' : 'Title'} aria-label="Title" autoFocus />
        {hits ? (
          <ul className="tmdb-hits">
            {hits.map((h) => (
              <li key={`${h.kind}${h.tmdbId}`}>
                <button className="tmdb-hit" onClick={() => void add({ title: h.title, kind: h.kind, year: h.year, tmdbId: h.tmdbId })}>
                  <Poster item={h} />
                  <span>
                    <strong>{h.title}</strong>
                    <span className="faint small">
                      {' '}
                      {[h.year, h.kind === 'tv' ? 'Series' : 'Film'].filter(Boolean).join(', ')}
                    </span>
                    {h.overview ? <span className="tmdb-overview small">{h.overview}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {q.trim() ? (
          <div className="watch-manual">
            <Segmented label="Kind" value={manual.kind} onChange={(kind) => setManual({ ...manual, kind })} options={[{ value: 'movie', label: 'Film' }, { value: 'tv', label: 'Series' }]} />
            <input className="input input-sm" style={{ width: 90 }} value={manual.year} onChange={(e) => setManual({ ...manual, year: e.target.value })} placeholder="Year" inputMode="numeric" aria-label="Year" />
            <button className="btn btn-sm" onClick={() => void add({ title: q.trim(), kind: manual.kind, year: manual.year ? Number(manual.year) : null, match: false })}>
              Add "{q.trim()}" {data.tmdb ? 'as typed' : ''}
            </button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ one title

function ItemSheet({ item, data, onClose: close }: { item: WatchItem; data: WatchSnapshot; onClose: () => void }) {
  const films = (useWork().data?.cards ?? []).filter((c) => c.board === 'film');
  const [note, setNote] = useState(item.note ?? '');
  // A note still being typed is saved however the drawer closes (Escape, the backdrop, Done).
  const saveNote = () => (item.status === 'watched' && note !== (item.note ?? '') ? save({ note: note || null }) : Promise.resolve());
  const onClose = () => void saveNote().then(close);
  const save = async (patch: Record<string, unknown>, done?: string) => {
    try {
      await watchMutate(() => api.put(`/api/watch/${item.id}`, patch));
      if (done) toast(done);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const p = item.providers;
  return (
    <Sheet
      title={item.title}
      subtitle={[item.year, item.kind === 'tv' ? (item.seasons ? `Series, ${item.seasons} season${item.seasons === 1 ? '' : 's'}` : 'Series') : item.runtime ? `Film, ${item.runtime} min` : 'Film', item.genres.slice(0, 3).join(', ')].filter(Boolean).join('. ')}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-danger"
            onClick={() =>
              ifConfirmed({ title: `Take ${item.title} off the watchlist?`, confirm: 'Remove' }, () =>
                watchMutate(() => api.del(`/api/watch/${item.id}`))
                  .then(close)
                  .catch((e: Error) => toast(e.message, 'error')),
              )
            }
          >
            Remove
          </button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="watch-item">
        <div className="watch-top">
          <Poster item={item} big />
          <div className="watch-side">
            <Segmented
              label="Status"
              value={item.status}
              onChange={(status) => void save({ status }, status === 'watched' ? 'Marked watched' : undefined)}
              options={WATCH_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            />
            {item.status === 'watched' ? (
              <>
                <div className="rating" role="radiogroup" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} role="radio" aria-checked={item.rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} className={item.rating != null && n <= item.rating ? 'on' : ''} onClick={() => void save({ rating: item.rating === n ? null : n })}>
                      <IconStar filled={item.rating != null && n <= item.rating} />
                    </button>
                  ))}
                </div>
                <input
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() => void saveNote()}
                  onKeyDown={(e) => e.key === 'Enter' && void saveNote()}
                  placeholder="One line on it"
                  maxLength={200}
                  aria-label="Note"
                />
                <span className="faint small">{item.watchedOn ? `Watched ${formatShort(item.watchedOn)}` : ''}</span>
              </>
            ) : null}
            {item.scores ? <ScoreLine scores={item.scores} imdbId={item.imdbId} /> : null}
            {p ? (
              <div className="providers">
                <span className="faint small">In Australia</span>
                {p.flatrate.length ? <span>Streaming on {p.flatrate.join(', ')}</span> : <span className="faint">Not on a streaming service</span>}
                {p.rent.length ? <span className="faint small">Rent: {p.rent.slice(0, 4).join(', ')}</span> : null}
                {p.link ? (
                  <a className="link-btn small" href={p.link} target="_blank" rel="noreferrer">
                    All options
                  </a>
                ) : null}
              </div>
            ) : data.tmdb && !item.tmdbId ? (
              <p className="faint small">Not matched on TMDB, so there are no details.</p>
            ) : null}
          </div>
        </div>
        {item.overview ? <p className="watch-overview">{item.overview}</p> : null}
        {films.length ? (
          <fieldset className="comps">
            <legend className="block-title">Comparison title for</legend>
            {films.map((c) => (
              <label key={c.id} className="check">
                <input
                  type="checkbox"
                  checked={item.comps.includes(c.id)}
                  onChange={(e) => {
                    const latest = watchStore.get()?.items.find((x) => x.id === item.id)?.comps ?? item.comps;
                    void save({ comps: e.target.checked ? [...new Set([...latest, c.id])] : latest.filter((x) => x !== c.id) });
                  }}
                />
                <span>{c.title}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>
    </Sheet>
  );
}
