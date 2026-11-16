// The command palette: Ctrl+K (⌘K on a Mac) from anywhere. Type to jump to
// any screen, start anything new, open a card, note or title, or search the
// documents. Arrow keys move, Enter runs, Escape closes.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { COLUMN_LABELS, BOARD_LABELS } from '../../shared/work/schemas.ts';
import { openEvent } from '../calendar/EventSheet.tsx';
import { localDate } from '../calendar/time.ts';
import { newDraft } from '../views/calendar/CalendarPage.tsx';
import { openEditor } from '../health/editors.tsx';
import { request } from '../lib/commands.ts';
import { paletteKey } from '../lib/keys.ts';
import { navigate, type Route } from '../lib/router.ts';
import { useNotes } from '../notes/store.ts';
import { openCapture } from '../views/notes/NotesArea.tsx';
import { openShortcuts } from './Shortcuts.tsx';
import { ColumnIcon } from '../views/work/Board.tsx';
import { useWatch } from '../watch/store.ts';
import { useRecipes } from '../recipes/store.ts';
import { recipeSearchText } from '../../shared/recipes/search.ts';
import { boardCards } from '../work/derive.ts';
import { useWork } from '../work/store.ts';
import { IconBoard, IconCalendar, IconCamera, IconDumbbell, IconFilm, IconHealth, IconInbox, IconMoney, IconNotes, IconPlus, IconRecipes, IconSearch, IconToday } from './icons.tsx';

type Item = { id: string; group: string; label: string; hint?: string; keywords?: string; icon: React.ReactNode; tint?: string; run: () => void };

let open = false;
const subs = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  subs.forEach((s) => s());
};
export const openPalette = () => setOpen(true);


const go = (r: Route) => () => navigate(r);

/** Screens to jump to, and things to start. Always on offer. */
function fixedItems(): Item[] {
  const nav = (id: string, label: string, hint: string, Icon: typeof IconToday, tint: string, r: Route, keywords = ''): Item => ({ id, group: 'Go to', label, hint, keywords, icon: <Icon />, tint, run: go(r) });
  const act = (id: string, label: string, Icon: typeof IconToday, run: () => void, keywords = '', tint?: string): Item => ({ id, group: 'Start', label, keywords, icon: <Icon />, tint, run });
  return [
    nav('today', 'Today', '', IconToday, 'var(--indigo)', { area: 'today' }, 'home'),
    nav('cal-week', 'Calendar', 'Week', IconCalendar, 'var(--red)', { area: 'calendar', view: 'week' }),
    nav('cal-month', 'Calendar', 'Month', IconCalendar, 'var(--red)', { area: 'calendar', view: 'month' }),
    nav('cal-agenda', 'Calendar', 'Agenda', IconCalendar, 'var(--red)', { area: 'calendar', view: 'agenda' }),
    nav('work-software', 'Software board', 'Work', IconBoard, 'var(--blue)', { area: 'work', tab: 'software' }, 'kanban tasks bugs'),
    nav('work-film', 'Film & TV board', 'Work', IconBoard, 'var(--blue)', { area: 'work', tab: 'film' }, 'kanban scripts projects'),
    nav('work-review', 'Weekly review', 'Work', IconBoard, 'var(--blue)', { area: 'work', tab: 'review' }, 'shipped focus'),
    nav('notes-ideas', 'Ideas inbox', 'Notes', IconNotes, '#e6a700', { area: 'notes', tab: 'ideas' }),
    nav('notes-notes', 'Notes', 'Notes', IconNotes, '#e6a700', { area: 'notes', tab: 'notes' }),
    nav('notes-links', 'Links', 'Notes', IconNotes, '#e6a700', { area: 'notes', tab: 'links' }),
    nav('notes-docs', 'Search documents', 'Notes', IconSearch, '#e6a700', { area: 'notes', tab: 'docs' }, 'find files scripts'),
    nav('money', 'Money', 'Overview', IconMoney, 'var(--green)', { area: 'money', tab: 'overview' }, 'owed tax'),
    nav('money-income', 'Income', 'Money', IconMoney, 'var(--green)', { area: 'money', tab: 'income' }, 'invoices paid'),
    nav('money-expenses', 'Expenses', 'Money', IconMoney, 'var(--green)', { area: 'money', tab: 'expenses' }, 'receipts'),
    nav('money-vault', 'Tax vault', 'Money', IconMoney, 'var(--green)', { area: 'money', tab: 'vault' }, 'documents ato irs w-8ben'),
    nav('watch', 'Watchlist', 'To watch', IconFilm, 'var(--purple)', { area: 'watch', status: 'to-watch' }, 'films series tv'),
    nav('recipes', 'Recipe vault', 'Recipes', IconRecipes, '#e8b571', { area: 'recipes' }, 'cooking food ingredients'),
    nav('watched', 'Watched', 'Watchlist', IconFilm, 'var(--purple)', { area: 'watch', status: 'watched' }),
    nav('health', 'Health', 'Overview', IconHealth, 'var(--pink)', { area: 'health', tab: 'overview' }),
    nav('health-nutrition', 'Nutrition', 'Health', IconHealth, 'var(--pink)', { area: 'health', tab: 'nutrition' }, 'food calories macros protein'),
    nav('health-training', 'Training', 'Health', IconHealth, 'var(--pink)', { area: 'health', tab: 'training' }, 'gym lifts program'),
    nav('health-body', 'Body', 'Health', IconHealth, 'var(--pink)', { area: 'health', tab: 'body' }, 'weight photos'),
    nav('health-log', 'Health log', 'Health', IconHealth, 'var(--pink)', { area: 'health', tab: 'log' }, 'month'),

    act('new-software', 'New software card', IconPlus, () => (navigate({ area: 'work', tab: 'software' }), request({ area: 'work', what: 'software' })), 'task bug feature', 'var(--blue)'),
    act('new-film', 'New Film & TV card', IconPlus, () => (navigate({ area: 'work', tab: 'film' }), request({ area: 'work', what: 'film' })), 'script project', 'var(--blue)'),
    act('new-event', 'New event', IconCalendar, () => openEvent({ draft: newDraft(localDate(new Date()), localDate(new Date())) }), 'calendar meeting appointment', 'var(--red)'),
    act('new-idea', 'Capture an idea', IconInbox, openCapture, 'thought', '#e6a700'),
    act('log-day', 'Log food and weight', IconHealth, () => openEditor({ kind: 'day' }), 'macrau calories weigh', 'var(--pink)'),
    act('log-workout', 'Log a workout', IconDumbbell, () => openEditor({ kind: 'workout' }), 'gym training', 'var(--pink)'),
    act('log-photo', 'Add a progress photo', IconCamera, () => openEditor({ kind: 'photo' }), '', 'var(--pink)'),
    act('new-income', 'Add income', IconMoney, () => (navigate({ area: 'money', tab: 'income' }), request({ area: 'money', what: 'income' })), 'invoice payment', 'var(--green)'),
    act('new-expense', 'Add an expense', IconMoney, () => (navigate({ area: 'money', tab: 'expenses' }), request({ area: 'money', what: 'expense' })), 'receipt', 'var(--green)'),
    act('new-vault', 'Add a tax document', IconMoney, () => (navigate({ area: 'money', tab: 'vault' }), request({ area: 'money', what: 'vault' })), 'vault form', 'var(--green)'),
    act('shortcuts', 'Keyboard shortcuts', IconSearch, openShortcuts, 'keys help'),
    act('new-watch', 'Add to the watchlist', IconFilm, () => (navigate({ area: 'watch', status: 'to-watch' }), request({ area: 'watch', what: 'add' })), 'film series', 'var(--purple)'),
    act('new-recipe', 'Save a recipe', IconRecipes, () => (navigate({ area: 'recipes' }), request({ area: 'recipes', what: 'add' })), 'cooking ingredients', '#e8b571'),
  ];
}

/** Every word typed must appear; words found at the start of a word rank higher. Null when it doesn't match. */
function score(item: Item, words: string[]): number | null {
  const label = item.label.toLowerCase();
  const all = `${label} ${(item.hint ?? '').toLowerCase()} ${(item.keywords ?? '').toLowerCase()}`;
  let total = 0;
  for (const w of words) {
    const i = all.indexOf(w);
    if (i < 0) return null;
    const start = i === 0 || /[^a-z0-9]/.test(all[i - 1]!);
    total += (i < label.length ? 4 : 1) + (start ? 3 : 0) + (i === 0 ? 2 : 0);
  }
  return total;
}

export function Palette() {
  const isOpen = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => open,
  );

  // Ctrl+K or ⌘K opens and closes it from anywhere, even while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return isOpen ? <PaletteDialog onClose={() => setOpen(false)} /> : null;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const work = useWork().data;
  const notes = useNotes().data;
  const watch = useWatch().data;
  const recipes = useRecipes().data;
  const fixed = useMemo(fixedItems, []);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => before?.focus?.();
  }, []);

  const items = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [...fixed.filter((i) => i.group === 'Start'), ...fixed.filter((i) => i.group === 'Go to' && !i.hint?.match(/^(Month|Agenda)$/))];
    const projects = new Map((work?.projects ?? []).map((p) => [p.id, p]));
    const data: Item[] = [
      // The cards the boards show: done ones drop off after two weeks there, and here.
      ...(work ? [...boardCards(work, 'software'), ...boardCards(work, 'film')] : []).map((c) => ({
          id: `card${c.id}`,
          group: 'Cards',
          label: c.title,
          hint: `${projects.get(c.projectId ?? -1)?.name ?? BOARD_LABELS[c.board]}, ${COLUMN_LABELS[c.column]}`,
          keywords: `${c.logline ?? ''} ${c.nextAction ?? ''}`,
          icon: <ColumnIcon column={c.column} />,
          run: go({ area: 'work', tab: c.board, card: c.id }),
        })),
      ...(notes?.notes ?? []).map((n) => ({ id: `note${n.file}`, group: 'Notes', label: n.title, hint: n.project ?? undefined, icon: <IconNotes />, tint: '#e6a700', run: go({ area: 'notes', tab: 'notes', param: n.file }) })),
      ...(recipes?.recipes ?? []).map((r) => ({ id: `recipe${r.id}`, group: 'Recipes', label: r.title, hint: r.tags.join(', '), keywords: recipeSearchText(r), icon: <IconRecipes />, tint: '#e8b571', run: go({ area: 'recipes', id: r.id }) })),
      ...(watch?.items ?? []).map((w) => ({
        id: `watch${w.id}`,
        group: 'Watchlist',
        label: w.title,
        hint: [w.year, w.status === 'watched' ? 'Watched' : w.status === 'watching' ? 'Watching' : 'To watch'].filter(Boolean).join(', '),
        icon: <IconFilm />,
        tint: 'var(--purple)',
        run: go({ area: 'watch', status: w.status, id: w.id }),
      })),
    ];
    const ranked = (pool: Item[], cap: number) =>
      pool
        .map((i) => ({ i, s: score(i, words) }))
        .filter((x): x is { i: Item; s: number } => x.s != null)
        .sort((a, b) => b.s - a.s)
        .slice(0, cap)
        .map((x) => x.i);
    const search: Item = {
      id: 'search-docs',
      group: 'Documents',
      label: `Search documents for “${q.trim()}”`,
      icon: <IconSearch />,
      tint: '#e6a700',
      run: () => (navigate({ area: 'notes', tab: 'docs' }), request({ area: 'docs', what: q.trim() })),
    };
    const groups = ['Start', 'Go to', 'Cards', 'Notes', 'Recipes', 'Watchlist'];
    const found = groups.flatMap((g) => ranked([...fixed, ...data].filter((i) => i.group === g), g === 'Cards' ? 6 : 5));
    return [...found, search];
  }, [q, fixed, work, notes, watch, recipes]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[active]);
    } else if (e.key === 'Escape') {
      // Only the palette closes, not a peek or page behind it.
      e.stopPropagation();
      e.preventDefault();
      onClose();
    }
  };

  let last = '';
  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="palette-search">
          <IconSearch />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to, start, or find anything…"
            aria-label="Search commands, cards, notes and titles"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `pal-${items[active]!.id}` : undefined}
            role="combobox"
            aria-expanded="true"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {items.map((item, i) => {
            const head = item.group !== last ? item.group : null;
            last = item.group;
            return (
              <div key={item.id}>
                {head ? <div className="palette-group">{head}</div> : null}
                <div
                  id={`pal-${item.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  className="palette-item"
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => run(item)}
                >
                  <span className="palette-icon" style={item.tint ? ({ '--tint': item.tint } as React.CSSProperties) : undefined}>
                    {item.icon}
                  </span>
                  <span className="palette-label">{item.label}</span>
                  {item.hint ? <span className="palette-hint">{item.hint}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
          <span className="palette-foot-right">
            <kbd>{paletteKey}</kbd> anywhere
          </span>
        </div>
      </div>
    </>
  );
}
