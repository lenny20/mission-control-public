import { useState } from 'react';
import { formatDow, formatShort, weekday, type DateStr } from '../../shared/dates.ts';
import { proteinHit } from '../../shared/health/metrics.ts';
import type { NutritionDay } from '../../shared/health/types.ts';
import { grams } from '../lib/format.ts';

/**
 * One square per day, in Monday-to-Sunday weeks. Filled: protein target hit.
 * Ring: logged but short. Faint: not logged.
 */
export function ProteinDays({ days, byDate, onPick }: { days: DateStr[]; byDate: Map<DateStr, NutritionDay>; onPick?: (d: DateStr) => void }) {
  const [hover, setHover] = useState<DateStr | null>(null);
  const lead = (weekday(days[0]!) + 6) % 7; // blanks before the first day so columns are weekdays
  const cells: (DateStr | null)[] = [...Array(lead).fill(null), ...days];
  const h = hover ? byDate.get(hover) : null;

  return (
    <div className="protein-days">
      <div className="protein-grid" role="list">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={`h${i}`} className="protein-dow" aria-hidden>
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`b${i}`} />;
          const n = byDate.get(d);
          const hit = n ? proteinHit(n) : null;
          const state = !n ? 'none' : hit ? 'hit' : 'miss';
          return (
            <button
              key={d}
              role="listitem"
              className={`protein-cell ${state}`}
              aria-label={`${formatDow(d)} ${formatShort(d)}: ${n ? `${grams(n.proteinG)} g protein${hit ? ', target hit' : ', under target'}` : 'not logged'}`}
              onPointerEnter={() => setHover(d)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(d)}
              onBlur={() => setHover(null)}
              onClick={() => onPick?.(d)}
            />
          );
        })}
      </div>
      <p className="protein-readout" aria-live="polite">
        {hover ? (
          <>
            <span className="muted">
              {formatDow(hover)} {formatShort(hover)}
            </span>{' '}
            {h ? (
              <>
                <strong className="num">{grams(h.proteinG)} g</strong>
                {h.proteinTargetG != null ? <span className="muted"> of {grams(h.proteinTargetG)} g</span> : null}
              </>
            ) : (
              <span className="muted">not logged</span>
            )}
          </>
        ) : (
          <span className="faint">Point at a day for its protein</span>
        )}
      </p>
    </div>
  );
}
