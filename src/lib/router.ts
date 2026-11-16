// Hash routes, so every screen has a link and the back button works.

import { useSyncExternalStore } from 'react';
import { isDateStr, type DateStr } from '../../shared/dates.ts';

export type Route =
  | { area: 'today' }
  | { area: 'calendar'; view: CalView; date?: DateStr }
  | { area: 'health'; tab: HealthTab; param?: string }
  | { area: 'work'; tab: WorkTab; card?: number }
  | { area: 'notes'; tab: NotesTab; param?: string }
  | { area: 'money'; tab: MoneyTab; id?: number }
  | { area: 'recipes'; id?: number }
  | { area: 'watch'; status: WatchView; id?: number };

export const HEALTH_TABS = ['overview', 'nutrition', 'training', 'body', 'log'] as const;
export type HealthTab = (typeof HEALTH_TABS)[number];

export const WORK_TABS = ['film', 'software', 'review'] as const;
export type WorkTab = (typeof WORK_TABS)[number];

export const NOTES_TABS = ['ideas', 'notes', 'links', 'docs'] as const;
/** 'view' is the document viewer, opened from search; it isn't a tab. */
export type NotesTab = (typeof NOTES_TABS)[number] | 'view';

export const MONEY_TABS = ['overview', 'income', 'expenses', 'vault'] as const;
export type MoneyTab = (typeof MONEY_TABS)[number];

export const WATCH_VIEWS = ['to-watch', 'watching', 'watched'] as const;
export type WatchView = (typeof WATCH_VIEWS)[number];

export const CAL_VIEWS = ['week', 'month', 'agenda'] as const;
export type CalView = (typeof CAL_VIEWS)[number];

function parse(hash: string): Route {
  const [area, tab, param] = hash.replace(/^#\/?/, '').split('/');
  if (area === 'recipes') {
    const id = Number(tab);
    return { area, id: Number.isInteger(id) && id > 0 ? id : undefined };
  }
  if (area === 'health') {
    // The health month grid was called Calendar before the real calendar arrived.
    const name = tab === 'calendar' ? 'log' : (tab ?? '');
    const t = (HEALTH_TABS as readonly string[]).includes(name) ? (name as HealthTab) : 'overview';
    return { area: 'health', tab: t, param: param ? decodeURIComponent(param) : undefined };
  }
  if (area === 'work') {
    const t = (WORK_TABS as readonly string[]).includes(tab ?? '') ? (tab as WorkTab) : 'software';
    const card = Number(param);
    return { area: 'work', tab: t, card: Number.isInteger(card) && card > 0 ? card : undefined };
  }
  if (area === 'money' || area === 'watch') {
    const n = Number(param);
    const id = Number.isInteger(n) && n > 0 ? n : undefined;
    if (area === 'money') return { area, tab: (MONEY_TABS as readonly string[]).includes(tab ?? '') ? (tab as MoneyTab) : 'overview', id };
    return { area, status: (WATCH_VIEWS as readonly string[]).includes(tab ?? '') ? (tab as WatchView) : 'to-watch', id };
  }
  if (area === 'notes') {
    const t = ([...NOTES_TABS, 'view'] as string[]).includes(tab ?? '') ? (tab as NotesTab) : 'ideas';
    // The viewer's path can hold slashes, so it's everything after the tab.
    const rest = hash.replace(/^#\/?/, '').split('/').slice(2).join('/');
    return { area: 'notes', tab: t, param: rest ? decodeURIComponent(rest) : undefined };
  }
  if (area === 'calendar') {
    const view = (CAL_VIEWS as readonly string[]).includes(tab ?? '') ? (tab as CalView) : 'week';
    return { area: 'calendar', view, date: param && isDateStr(param) ? param : undefined };
  }
  return { area: 'today' };
}

export function href(route: Route): string {
  if (route.area === 'recipes') return `#/recipes${route.id ? `/${route.id}` : ''}`;
  if (route.area === 'health') return `#/health/${route.tab}${route.param ? `/${encodeURIComponent(route.param)}` : ''}`;
  if (route.area === 'money') return `#/money/${route.tab}${route.id ? `/${route.id}` : ''}`;
  if (route.area === 'watch') return `#/watch/${route.status}${route.id ? `/${route.id}` : ''}`;
  if (route.area === 'notes') return `#/notes/${route.tab}${route.param ? `/${encodeURIComponent(route.param)}` : ''}`;
  if (route.area === 'work') return `#/work/${route.tab}${route.card ? `/${route.card}` : ''}`;
  if (route.area === 'calendar') return `#/calendar/${route.view}${route.date ? `/${route.date}` : ''}`;
  return '#/today';
}

/**
 * A screen with unsaved work can ask before anything moves away from it.
 * The guard returns true to let the move happen.
 */
let leaveGuard: (() => boolean) | null = null;
export function setLeaveGuard(fn: () => boolean): () => void {
  leaveGuard = fn;
  return () => {
    if (leaveGuard === fn) leaveGuard = null;
  };
}
const mayLeave = () => !leaveGuard || leaveGuard();

// Keep the rendered route separate from the address until leaving is approved.
// Hash changes include Back and Forward, which don't go through links or navigate.
// Number history entries so cancelling returns to the original entry without
// replacing a previous page or adding another entry to the history.
const historyIndex = (): number | null => {
  const index: unknown = window.history.state?.mcRouteIndex;
  return typeof index === 'number' && Number.isInteger(index) ? index : null;
};
const stampHistory = (index: number, url?: string) => window.history.replaceState({ ...window.history.state, mcRouteIndex: index }, '', url);
let currentHash = window.location.hash;
let currentIndex = historyIndex() ?? 0;
stampHistory(currentIndex);
const subscribers = new Set<() => void>();

window.addEventListener('hashchange', () => {
  const nextHash = window.location.hash;
  const nextIndex = historyIndex();
  // A rejected navigation has returned to the page whose draft is still open.
  if (nextHash === currentHash) {
    currentIndex = nextIndex ?? currentIndex;
    return;
  }
  if (!mayLeave()) {
    if (nextIndex !== null && nextIndex !== currentIndex) window.history.go(currentIndex - nextIndex);
    // Entries made before this router loaded have no index to return by.
    else stampHistory(currentIndex, currentHash || `${window.location.pathname}${window.location.search}`);
    return;
  }
  currentHash = nextHash;
  currentIndex = nextIndex ?? currentIndex + 1;
  stampHistory(currentIndex);
  subscribers.forEach((cb) => cb());
});

function navigateHash(hash: string) {
  if (hash === currentHash || !mayLeave()) return;
  currentIndex++;
  window.history.pushState({ mcRouteIndex: currentIndex }, '', hash);
  currentHash = hash;
  subscribers.forEach((cb) => cb());
}

// Check new in-app navigation before creating a history entry. Modified clicks
// and links opening another tab leave the current draft in place.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  const a = (e.target as Element | null)?.closest?.('a[href^="#/"]');
  if (!a || a.hasAttribute('download') || (a.getAttribute('target') && a.getAttribute('target') !== '_self')) return;
  e.preventDefault();
  navigateHash(a.getAttribute('href')!);
});

export function navigate(route: Route) {
  navigateHash(href(route));
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    () => currentHash,
  );
  return parse(hash);
}
