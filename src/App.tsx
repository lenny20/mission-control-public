import { useProfile } from './profile.ts';
import { Settings } from './ui/Settings.tsx';
import { Fragment, useEffect, useState } from 'react';
import { EventHost } from './calendar/EventSheet.tsx';
import { EditorHost } from './health/editors.tsx';
import { CalendarPage } from './views/calendar/CalendarPage.tsx';
import { HealthView } from './views/health/HealthView.tsx';
import { WorkPage } from './views/work/WorkPage.tsx';
import { CaptureHost, NotesArea } from './views/notes/NotesArea.tsx';
import { MoneyPage } from './views/money/MoneyPage.tsx';
import { WatchPage } from './views/watch/WatchPage.tsx';
import { RecipesPage } from './views/recipes/RecipesPage.tsx';
import { Today } from './views/Today.tsx';
import { href, navigate, useRoute, type Route } from './lib/router.ts';
import { useKey } from './lib/hooks.ts';
import { useHealth } from './lib/store.ts';
import { IconBoard, IconCalendar, IconFilm, IconHealth, IconMoney, IconNotes, IconRecipes, IconSearch, IconSliders, IconToday } from './ui/icons.tsx';
import { ConfirmHost } from './ui/confirm.tsx';
import { paletteKey } from './lib/keys.ts';
import { openPalette, Palette } from './ui/Palette.tsx';
import { openShortcuts, ShortcutsHost } from './ui/Shortcuts.tsx';
import { Toasts } from './ui/toast.tsx';

/** Each area has its own colour, used for its icon square. */
const NAV: { area: Route['area']; label: string; Icon: typeof IconToday; tint: string; to: Route }[][] = [
  [{ area: 'today', label: 'Today', Icon: IconToday, tint: 'var(--indigo)', to: { area: 'today' } }],
  [
    { area: 'calendar', label: 'Calendar', Icon: IconCalendar, tint: 'var(--red)', to: { area: 'calendar', view: 'week' } },
    { area: 'work', label: 'Work', Icon: IconBoard, tint: 'var(--blue)', to: { area: 'work', tab: 'software' } },
    { area: 'notes', label: 'Notes', Icon: IconNotes, tint: '#e6a700', to: { area: 'notes', tab: 'ideas' } },
  ],
  [
    { area: 'money', label: 'Money', Icon: IconMoney, tint: 'var(--green)', to: { area: 'money', tab: 'overview' } },
    { area: 'watch', label: 'Watch', Icon: IconFilm, tint: 'var(--purple)', to: { area: 'watch', status: 'to-watch' } },
    { area: 'health', label: 'Health', Icon: IconHealth, tint: 'var(--pink)', to: { area: 'health', tab: 'overview' } },
    { area: 'recipes', label: 'Recipes', Icon: IconRecipes, tint: '#e8b571', to: { area: 'recipes' } },
  ],
];

/**
 * Each page is lit by two colours: its own, and a second that sits beside it
 * on the wheel, so the canvas holds a colour field rather than a grey slab.
 * Today is lit by the time of day instead: a warm morning, a clear blue day,
 * a violet evening and a deep blue night.
 */
function todayLight(hour: number): [string, string] {
  if (hour >= 5 && hour < 11) return ['#ff9d4d', '#ff5f8f'];
  if (hour >= 11 && hour < 17) return ['#3d8bff', '#22d3ee'];
  if (hour >= 17 && hour < 21) return ['#7a5cff', '#e0569b'];
  return ['#3550e6', '#14b8a6'];
}

const AREA_LIGHT: Record<Exclude<Route['area'], 'today'>, [string, string]> = {
  calendar: ['var(--red)', '#ff8a3d'],
  work: ['var(--blue)', '#8b5cf6'],
  notes: ['#e6a700', '#ff7a45'],
  money: ['var(--green)', '#14b8a6'],
  watch: ['var(--purple)', '#ff3d8b'],
  health: ['var(--pink)', '#a855f7'],
  recipes: ['#e8b571', '#8aab84'],
};

function lightOf(area: Route['area']): React.CSSProperties {
  const [a, b] = area === 'today' ? todayLight(new Date().getHours()) : AREA_LIGHT[area];
  return { '--area': a, '--area-2': b } as React.CSSProperties;
}

export function App() {
  const route = useRoute();
  const personal = useProfile();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data, error } = useHealth();
  // "/" searches from anywhere; on the Search tab itself, that page focuses its field.
  const onSearch = route.area === 'notes' && route.tab === 'docs';
  useKey(
    '/',
    (e) => {
      if (document.querySelector('.sheet')) return;
      e.preventDefault();
      navigate({ area: 'notes', tab: 'docs' });
    },
    !onSearch,
  );

  useEffect(() => {
    const names = { today: 'Today', calendar: 'Calendar', work: 'Work', notes: 'Notes', money: 'Money', watch: 'Watchlist', health: 'Health', recipes: 'Recipes' };
    document.title = `${names[route.area]} | Mission Control`;
  }, [route.area]);

  return (
    <div className="shell" style={lightOf(route.area)}>
      <nav className="rail" aria-label="Areas">
        <a className="rail-mark" href={href({ area: 'today' })} aria-label="Mission Control">
          <span className="rail-logo" aria-hidden="true">
            <svg viewBox="0 0 18 18">
              <circle cx="9" cy="9" r="6.25" fill="none" stroke="rgb(255 255 255 / 0.14)" strokeWidth="2" />
              <circle cx="9" cy="9" r="6.25" fill="none" stroke="var(--area)" strokeWidth="2" strokeLinecap="round" strokeDasharray="27 40" transform="rotate(-90 9 9)" style={{ filter: 'drop-shadow(0 0 3px var(--area))' }} />
              <circle cx="9" cy="9" r="1.9" fill="#fff" />
            </svg>
          </span>
          <span>Mission Control</span>
        </a>
        <button className="rail-search" onClick={openPalette} title="Jump to, start or find anything">
          <IconSearch /> Search <kbd>{paletteKey}</kbd>
        </button>
        {NAV.map((group, i) => (
          <Fragment key={i}>
            {i ? <span className="rail-sep" aria-hidden="true" /> : null}
            {group.filter(({ area }) => area === 'today' || !personal.data || personal.data.profile.sidebarAreas.includes(area)).map(({ area, label, Icon, tint, to }) => (
              <a key={area} className="rail-link" href={href(to)} aria-current={route.area === area ? 'page' : undefined} aria-label={label} title={label} style={{ '--tint': tint } as React.CSSProperties}>
                <span className="rail-icon">
                  <Icon />
                </span>
                <span>{label}</span>
              </a>
            ))}
          </Fragment>
        ))}
        <button className="rail-link rail-settings" aria-label="Your dashboard" title="Your dashboard" onClick={() => setSettingsOpen(true)}><span className="rail-icon"><IconSliders /></span><span>Your dashboard</span></button>
        <button className="rail-foot" onClick={openShortcuts}>
          <kbd>?</kbd> Keyboard shortcuts
        </button>
      </nav>
      <main className="main">
        {personal.error && <p className="form-error" role="alert">Settings could not load: {personal.error}</p>}
        {personal.data && !personal.data.profile.setupComplete && <div className="board-hint"><button className="btn" onClick={() => setSettingsOpen(true)}>Make this dashboard yours</button> <span className="faint">Choose your name and shortcuts. Connect accounts whenever you are ready.</span></div>}
        {error && !data ? (
          <div className="page">
            <div className="empty">
              <strong>Mission Control can't load your data.</strong>
              {error}
            </div>
          </div>
        ) : !data ? (
          <div className="page loading" aria-busy="true" />
        ) : route.area === 'today' ? (
          <Today data={data} />
        ) : route.area === 'work' ? (
          <WorkPage tab={route.tab} card={route.card} />
        ) : route.area === 'notes' ? (
          <NotesArea tab={route.tab} param={route.param} watchReady />
        ) : route.area === 'money' ? (
          <MoneyPage tab={route.tab} id={route.id} />
        ) : route.area === 'watch' ? (
          <WatchPage status={route.status} id={route.id} />
        ) : route.area === 'recipes' ? (
          <RecipesPage id={route.id} />
        ) : route.area === 'calendar' ? (
          <CalendarPage view={route.view} date={route.date} today={data.today} />
        ) : (
          <HealthView data={data} tab={route.tab} param={route.param} />
        )}
      </main>
      {settingsOpen && personal.data && <Settings profile={personal.data.profile} connections={personal.data.connections} onClose={() => setSettingsOpen(false)} />}
      <EditorHost />
      <EventHost />
      <CaptureHost />
      <Palette />
      <ShortcutsHost />
      <ConfirmHost />
      <Toasts />
    </div>
  );
}
