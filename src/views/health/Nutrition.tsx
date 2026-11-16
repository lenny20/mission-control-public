import { useState } from 'react';
import { formatDow, formatShort } from '../../../shared/dates.ts';
import { belowTarget, macroSplit, proteinHit } from '../../../shared/health/metrics.ts';
import type { HealthSnapshot, NutritionDay } from '../../../shared/health/types.ts';
import { CaloriesChart } from '../../charts/CaloriesChart.tsx';
import { lastDays, type Derived } from '../../health/derive.ts';
import { openEditor } from '../../health/editors.tsx';
import { grams, kcal, kg, pct, plural } from '../../lib/format.ts';
import { Segmented } from '../../ui/fields.tsx';
import { IconCheck } from '../../ui/icons.tsx';

type Span = 14 | 28 | 84;

function average(days: NutritionDay[], pick: (n: NutritionDay) => number | null) {
  const vals = days.map(pick).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function Nutrition({ data, d }: { data: HealthSnapshot; d: Derived }) {
  const [span, setSpan] = useState<Span>(28);
  const days = lastDays(data.today, span);
  const logged = days.map((x) => d.nutritionByDate.get(x)).filter((n): n is NutritionDay => !!n);
  const rows = [...data.nutrition].reverse();
  const split = logged.length
    ? macroSplit({ proteinG: average(logged, (n) => n.proteinG), carbsG: average(logged, (n) => n.carbsG), fatG: average(logged, (n) => n.fatG) })
    : null;

  return (
    <>
      <div className="section-head">
        <h2>Averages, last {span === 84 ? '12 weeks' : `${span / 7} weeks`}</h2>
        <Segmented
          label="Time range"
          value={String(span) as `${Span}`}
          options={[
            { value: '14', label: '2 weeks' },
            { value: '28', label: '4 weeks' },
            { value: '84', label: '12 weeks' },
          ]}
          onChange={(v) => setSpan(Number(v) as Span)}
        />
      </div>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Calories</span>
          <span className="stat-value">
            {kcal(average(logged, (n) => n.eatenKcal))}
            <span className="stat-unit">a day</span>
          </span>
          <span className="stat-sub">{logged.length} of {span} days logged</span>
        </div>
        <div className="stat">
          <span className="stat-label">
            <span className="dot" style={{ background: 'var(--protein)' }} /> Protein
          </span>
          <span className="stat-value">
            {grams(average(logged, (n) => n.proteinG))}
            <span className="stat-unit">g a day</span>
          </span>
          <span className="stat-sub">Target hit on {plural(logged.filter((n) => proteinHit(n)).length, 'day')}</span>
        </div>
        <div className="stat">
          <span className="stat-label">
            <span className="dot" style={{ background: 'var(--carbs)' }} /> Carbs
          </span>
          <span className="stat-value">
            {grams(average(logged, (n) => n.carbsG))}
            <span className="stat-unit">g a day</span>
          </span>
          <span className="stat-sub">{split ? `${pct(split.carbs)} of calories` : '–'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">
            <span className="dot" style={{ background: 'var(--fat)' }} /> Fat
          </span>
          <span className="stat-value">
            {grams(average(logged, (n) => n.fatG))}
            <span className="stat-unit">g a day</span>
          </span>
          <span className="stat-sub">{split ? `${pct(split.fat)} of calories` : '–'}</span>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Calories against target</h2>
          <p>Target includes exercise added back, the same sum Macrau uses.</p>
        </div>
        <div className="chart-panel">
          <CaloriesChart days={days} byDate={d.nutritionByDate} height={260} onPick={(date) => openEditor({ kind: 'day', date })} />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Every day logged</h2>
          <button className="btn btn-sm" onClick={() => openEditor({ kind: 'day' })}>
            Add a day
          </button>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table day-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th className="r">
                    <span className="th-key" style={{ background: 'var(--calories)' }} />
                    Eaten
                  </th>
                  <th className="r">Target</th>
                  <th className="r">Difference</th>
                  <th className="r">
                    <span className="th-key" style={{ background: 'var(--protein)' }} />
                    Protein
                  </th>
                  <th className="r">
                    <span className="th-key" style={{ background: 'var(--carbs)' }} />
                    Carbs
                  </th>
                  <th className="r">
                    <span className="th-key" style={{ background: 'var(--fat)' }} />
                    Fat
                  </th>
                  <th className="r">
                    <span className="th-key" style={{ background: 'var(--weight)' }} />
                    Weight
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => {
                  const below = belowTarget(n);
                  const w = d.weightByDate.get(n.date);
                  const open = () => openEditor({ kind: 'day', date: n.date });
                  return (
                    <tr key={n.date} className={below == null ? '' : below >= 0 ? 'day-under' : 'day-over'} tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()}>
                      <td>
                        <strong>{formatDow(n.date)}</strong> <span className="muted">{formatShort(n.date)}</span>
                      </td>
                      <td className="r day-eaten">{kcal(n.eatenKcal)}</td>
                      <td className="r muted">{n.targetKcal != null ? kcal(n.targetKcal + n.burnedKcal) : '–'}</td>
                      <td className="r">
                        {below == null ? '–' : below >= 0 ? <span className="under-text">{kcal(below)} under</span> : <span className="over-text">{kcal(-below)} over</span>}
                      </td>
                      <td className={`r day-protein ${proteinHit(n) ? 'is-hit' : ''}`}>
                        {grams(n.proteinG)}
                        {proteinHit(n) ? <IconCheck className="hit-check" title="Protein target hit" /> : <span className="hit-check-space" />}
                      </td>
                      <td className="r day-carbs">{grams(n.carbsG)}</td>
                      <td className="r day-fat">{grams(n.fatG)}</td>
                      <td className="r day-weight">{w ? kg(w.kg) : <span className="faint">–</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <strong>No days logged yet.</strong>
            Send Claude a Macrau daily recap, or add a day by hand.
          </div>
        )}
      </section>
    </>
  );
}
