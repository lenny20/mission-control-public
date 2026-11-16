import { useEffect, useState } from 'react';
import { daysBetween } from '../../../shared/dates.ts';
import { BOARD_LABELS, type Column } from '../../../shared/work/schemas.ts';
import type { WorkSnapshot } from '../../../shared/work/types.ts';
import { navigate, href, WORK_TABS, type WorkTab } from '../../lib/router.ts';
import { useRequest } from '../../lib/commands.ts';
import { useKey } from '../../lib/hooks.ts';
import { IconChevron, IconFilter, IconFolder, IconPlus, IconSliders, IconSpark } from '../../ui/icons.tsx';
import { Menu, MenuHeading, MenuItem, MenuToggle } from '../../ui/Menu.tsx';
import { CardPeek } from '../../work/CardPeek.tsx';
import { CardSheet, type CardEditor } from '../../work/CardSheet.tsx';
import { boardCards, shippedCount, shippedThisWeek } from '../../work/derive.ts';
import { useWork } from '../../work/store.ts';
import { Board, columnCards, type CardDisplay } from './Board.tsx';
import { ProjectsSheet } from './ProjectsSheet.tsx';
import { Review } from './Review.tsx';

const LABELS: Record<WorkTab, string> = { film: BOARD_LABELS.film, software: BOARD_LABELS.software, review: 'Weekly review' };

/** A per-browser view preference; never data. */
function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  return [
    v,
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private windows can refuse storage; the preference just isn't kept.
      }
    },
  ];
}

export function WorkPage({ tab, card }: { tab: WorkTab; card?: number }) {
  const { data, error } = useWork();
  const [draft, setDraft] = useState<CardEditor | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [filter, setFilter] = usePref<number | null>('work.projectFilter', null);
  const [groupDoing, setGroupDoing] = usePref('work.groupDoing', false);
  const [display, setDisplay] = usePref<CardDisplay>('work.display', { logline: true, nextAction: true, project: true, colour: true });
  const [folded, setFolded] = usePref<Column[]>('work.folded', []);
  const board = tab === 'review' ? null : tab;
  // A filter for a project that's gone shows everything.
  const activeFilter = data && filter != null && data.projects.some((p) => p.id === filter) ? filter : null;

  // "New card" from the command palette.
  useRequest('work', (b) => setDraft({ draft: { board: b, projectId: null } }));

  const sheetOpen = () => !!document.querySelector('.sheet');
  useKey('n', (e) => {
    if (sheetOpen() || !board) return;
    e.preventDefault();
    setDraft({ draft: { board, projectId: activeFilter } });
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey || sheetOpen()) return;
      const next = WORK_TABS[Number(e.key) - 1];
      if (next) navigate({ area: 'work', tab: next });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shipped = data ? shippedCount(shippedThisWeek(data)) : 0;
  const peekCard = data && card ? data.cards.find((c) => c.id === card) : undefined;
  // J and K step through the peeked card's column, as the board shows it.
  const siblings = data && peekCard ? columnCards(boardCards(data, peekCard.board), peekCard.column, new Map(data.projects.map((p) => [p.id, p])), activeFilter) : [];
  const at = siblings.findIndex((c) => c.id === card);
  const peekTab = peekCard?.board ?? board ?? 'software';

  return (
    <div className={`page work-page ${card ? 'peeking' : ''}`}>
      <header className="page-head">
        <h1 className="page-title">Work</h1>
        <nav className="tabs" aria-label="Work sections">
          {WORK_TABS.map((t, i) => (
            <a key={t} className="tab" href={href({ area: 'work', tab: t })} aria-current={t === tab ? 'page' : undefined} title={`Press ${i + 1}`}>
              {LABELS[t]}
            </a>
          ))}
        </nav>
        <div className="head-actions">
          {shipped ? (
            <a className="shipped" href={href({ area: 'work', tab: 'review' })}>
              <IconSpark /> <span className="num">{shipped}</span> shipped this week
            </a>
          ) : null}
          <button className="btn" onClick={() => setProjectsOpen(true)}>
            <IconFolder /> Projects
          </button>
          {board ? (
            <button className="btn btn-primary" onClick={() => setDraft({ draft: { board, projectId: activeFilter } })} title="New card (N)">
              <IconPlus /> New card
            </button>
          ) : null}
        </div>
      </header>

      {error && !data ? (
        <div className="empty">
          <strong>The boards couldn't load.</strong>
          {error}
        </div>
      ) : !data ? (
        <div className="loading" aria-busy="true" />
      ) : board ? (
        <>
          <div className="board-tools">
            {data.projects.length ? <ProjectFilter data={data} board={board} value={activeFilter} onChange={setFilter} /> : null}
            <Menu
              label="Display"
              trigger={
                <>
                  <IconSliders /> Display
                </>
              }
            >
              {() => (
                <>
                  <MenuHeading>On cards</MenuHeading>
                  <MenuToggle on={display.colour !== false} onChange={(colour) => setDisplay({ ...display, colour })}>
                    Colour cards
                  </MenuToggle>
                  <MenuToggle on={display.project} onChange={(project) => setDisplay({ ...display, project })}>
                    Project
                  </MenuToggle>
                  {board === 'film' ? (
                    <>
                      <MenuToggle on={display.logline} onChange={(logline) => setDisplay({ ...display, logline })}>
                        Logline
                      </MenuToggle>
                      <MenuToggle on={display.nextAction} onChange={(nextAction) => setDisplay({ ...display, nextAction })}>
                        Next action
                      </MenuToggle>
                    </>
                  ) : (
                    <MenuToggle on={groupDoing} onChange={setGroupDoing}>
                      Group Doing by project
                    </MenuToggle>
                  )}
                  {folded.length ? (
                    <>
                      <MenuHeading>Folded columns</MenuHeading>
                      <MenuItem inset onSelect={() => setFolded([])}>
                        Unfold all
                      </MenuItem>
                    </>
                  ) : null}
                </>
              )}
            </Menu>
            <BoardSummary data={data} board={board} filter={activeFilter} />
          </div>
          {!data.projects.length ? (
            <p className="board-hint faint">
              Projects group cards on either board, coloured by their category.{' '}
              <button className="link-btn" onClick={() => setProjectsOpen(true)}>
                Add your first project
              </button>
            </p>
          ) : null}
          <Board
            data={data}
            board={board}
            filter={activeFilter}
            groupDoing={groupDoing}
            display={display}
            folded={folded}
            peeking={card ?? null}
            onFold={(c) => setFolded(folded.includes(c) ? folded.filter((x) => x !== c) : [...folded, c])}
            onPeek={(id) => navigate({ area: 'work', tab: board, card: id ?? undefined })}
            onNew={(column: Column) => setDraft({ draft: { board, column, projectId: activeFilter } })}
          />
        </>
      ) : (
        <Review data={data} />
      )}

      {data && card ? (
        <CardPeek
          key={card}
          data={data}
          cardId={card}
          prev={at > 0 ? siblings[at - 1]!.id : undefined}
          next={at >= 0 && at < siblings.length - 1 ? siblings[at + 1]!.id : undefined}
          onGo={(id) => navigate({ area: 'work', tab: peekTab, card: id })}
          onClose={() => navigate({ area: 'work', tab })}
        />
      ) : null}
      {data && draft ? <CardSheet key={JSON.stringify(draft)} data={data} editor={draft} onClose={() => setDraft(null)} /> : null}
      {data && projectsOpen ? <ProjectsSheet data={data} onClose={() => setProjectsOpen(false)} /> : null}
    </div>
  );
}

/** Stages where work is under way, by board. */
const UNDER_WAY = new Set<Column>(['doing', 'developing', 'writing', 'out', 'in-play']);

/** The board at a glance: how much is on it, how much is under way, and what's due this week. */
function BoardSummary({ data, board, filter }: { data: WorkSnapshot; board: 'film' | 'software'; filter: number | null }) {
  const cards = boardCards(data, board).filter((c) => filter == null || c.projectId === filter);
  const live = cards.filter((c) => c.column !== 'done' && c.column !== 'shelved');
  const going = live.filter((c) => UNDER_WAY.has(c.column)).length;
  const due = live.filter((c) => c.due && daysBetween(data.today, c.due) <= 7).length;
  return (
    <span className="board-sum">
      <span className="board-stat">
        <span className="num">{cards.length}</span> {cards.length === 1 ? 'card' : 'cards'}
      </span>
      <span className="board-stat is-going">
        <span className="num">{going}</span> under way
      </span>
      {due ? (
        <span className="board-stat is-due">
          <span className="num">{due}</span> due this week
        </span>
      ) : null}
    </span>
  );
}

/** The board's project filter: one menu, projects grouped under their categories. */
function ProjectFilter({ data, board, value, onChange }: { data: WorkSnapshot; board: 'film' | 'software'; value: number | null; onChange: (id: number | null) => void }) {
  const counts = new Map<number, number>();
  for (const c of boardCards(data, board)) if (c.projectId) counts.set(c.projectId, (counts.get(c.projectId) ?? 0) + 1);
  const current = data.projects.find((p) => p.id === value);
  const groups = [...data.categories.map((cat) => ({ name: cat.name, projects: data.projects.filter((p) => p.categoryId === cat.id) })), { name: 'No category', projects: data.projects.filter((p) => p.categoryId == null) }].filter((g) => g.projects.length);
  return (
    <Menu
      label="Show project"
      trigger={
        <>
          {current ? <span className="dot" style={{ background: current.colour }} /> : <IconFilter />}
          {current?.name ?? 'All projects'}
          <IconChevron className="menu-chev" />
        </>
      }
    >
      {(close) => (
        <>
          <MenuItem checked={value == null} onSelect={() => (onChange(null), close())}>
            All projects
          </MenuItem>
          {groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name}>
              <MenuHeading>{g.name}</MenuHeading>
              {g.projects.map((p) => (
                <MenuItem key={p.id} checked={value === p.id} onSelect={() => (onChange(p.id), close())}>
                  <span className="dot" style={{ background: p.colour }} />
                  <span className="menu-label">
                    {p.name}
                    {p.status === 'paused' ? <span className="faint"> (paused)</span> : null}
                  </span>
                  <span className="menu-count num">{counts.get(p.id) ?? ''}</span>
                </MenuItem>
              ))}
            </div>
          ))}
        </>
      )}
    </Menu>
  );
}
