import type { NutritionDay } from '../../shared/health/types.ts';
import { grams, gramsExact, kcal } from '../lib/format.ts';

const MACROS = [
  { key: 'protein', label: 'Protein', g: 'proteinG', t: 'proteinTargetG', color: 'var(--protein)', track: 'var(--protein-track)' },
  { key: 'carbs', label: 'Carbs', g: 'carbsG', t: 'carbsTargetG', color: 'var(--carbs)', track: 'var(--carbs-track)' },
  { key: 'fat', label: 'Fat', g: 'fatG', t: 'fatTargetG', color: 'var(--fat)', track: 'var(--fat-track)' },
] as const;

/** Calories plus the three macros as progress bars against target, Macrau-style. */
export function MacroBars({ day, exact = false, showCalories = true }: { day: NutritionDay; exact?: boolean; showCalories?: boolean }) {
  const target = day.targetKcal != null ? day.targetKcal + day.burnedKcal : null;
  const rows = [
    ...(showCalories ? [{ key: 'cal', label: 'Calories', value: day.eatenKcal, target, color: 'var(--calories)', track: 'var(--calories-track)', unit: '', fmt: kcal }] : []),
    ...MACROS.map((mc) => ({ key: mc.key, label: mc.label, value: day[mc.g], target: day[mc.t], color: mc.color, track: mc.track, unit: 'g', fmt: exact ? gramsExact : grams })),
  ];
  return (
    <div className="macro-bars">
      {rows.map((r) => {
        const ratio = r.value != null && r.target ? r.value / r.target : 0;
        const over = ratio > 1;
        return (
          <div className="macro-row" key={r.key} style={{ '--c': r.color, '--track': r.track } as React.CSSProperties}>
            <span className="macro-label">
              <span className="dot" />
              {r.label}
            </span>
            <span className="macro-track">
              <span className="macro-fill" style={{ width: `${Math.min(1, ratio) * 100}%` }} />
              {over ? <span className="macro-over" title="Over target" /> : null}
            </span>
            <span className="macro-value num">
              <strong>{r.fmt(r.value)}</strong>
              {r.target != null ? (
                <span className="faint">
                  {' '}
                  / {r.fmt(r.target)}
                  {r.unit}
                </span>
              ) : (
                <span className="faint">{r.unit}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
