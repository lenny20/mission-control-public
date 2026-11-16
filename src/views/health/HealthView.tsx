import { useEffect } from 'react';
import type { HealthSnapshot } from '../../../shared/health/types.ts';
import { useDerived } from '../../health/derive.ts';
import { openEditor } from '../../health/editors.tsx';
import { HEALTH_TABS, href, navigate, type HealthTab } from '../../lib/router.ts';
import { IconCamera, IconDumbbell, IconPlus } from '../../ui/icons.tsx';
import { Body } from './Body.tsx';
import { LogView } from './LogView.tsx';
import { Nutrition } from './Nutrition.tsx';
import { Overview } from './Overview.tsx';
import { Training } from './Training.tsx';

const LABELS: Record<HealthTab, string> = {
  overview: 'Overview',
  nutrition: 'Nutrition',
  training: 'Training',
  body: 'Body',
  log: 'Log',
};

export function HealthView({ data, tab, param }: { data: HealthSnapshot; tab: HealthTab; param?: string }) {
  const d = useDerived(data);
  // Number keys 1 to 5 jump between tabs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.sheet')) return;
      const tab = HEALTH_TABS[Number(e.key) - 1];
      if (tab) navigate({ area: 'health', tab });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">Health</h1>
        <nav className="tabs" aria-label="Health sections">
          {HEALTH_TABS.map((t, i) => (
            <a key={t} className="tab" href={href({ area: 'health', tab: t })} aria-current={t === tab ? 'page' : undefined} title={`Press ${i + 1}`}>
              {LABELS[t]}
            </a>
          ))}
        </nav>
        <div className="head-actions">
          <button className="btn" onClick={() => openEditor({ kind: 'day' })}>
            <IconPlus /> Food & weight
          </button>
          <button className="btn" onClick={() => openEditor({ kind: 'workout', programDayId: d.cycle.next?.id ?? null })}>
            <IconDumbbell /> Workout
          </button>
          <button className="btn" onClick={() => openEditor({ kind: 'photo' })}>
            <IconCamera /> Photo
          </button>
        </div>
      </header>
      {tab === 'overview' ? <Overview data={data} d={d} /> : null}
      {tab === 'nutrition' ? <Nutrition data={data} d={d} /> : null}
      {tab === 'training' ? <Training data={data} d={d} liftId={param} /> : null}
      {tab === 'body' ? <Body data={data} d={d} /> : null}
      {tab === 'log' ? <LogView data={data} d={d} month={param} /> : null}
    </div>
  );
}
