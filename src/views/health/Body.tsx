import { useState } from 'react';
import { formatDayMonthYear, formatDow, formatShort } from '../../../shared/dates.ts';
import type { HealthSnapshot } from '../../../shared/health/types.ts';
import type { Derived } from '../../health/derive.ts';
import { openEditor } from '../../health/editors.tsx';
import { kg, signed } from '../../lib/format.ts';
import { IconPlus } from '../../ui/icons.tsx';
import { PhotoPair, WeightSection } from './Overview.tsx';

export function Body({ data, d }: { data: HealthSnapshot; d: Derived }) {
  const [showAll, setShowAll] = useState(false);
  const trendByDate = new Map(d.trend.map((p) => [p.date, p.trend]));
  const weighIns = [...data.weights].reverse();
  const visible = showAll ? weighIns : weighIns.slice(0, 12);
  const photos = [...data.photos].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const [beforeId, setBeforeId] = useState<number | null>(null);
  const [afterId, setAfterId] = useState<number | null>(null);
  const before = photos.find((p) => p.id === beforeId) ?? photos[0] ?? null;
  const after = photos.find((p) => p.id === afterId) ?? (photos.length > 1 ? photos.at(-1)! : null);

  return (
    <>
      <WeightSection data={data} d={d} height={360} />

      <section className="section" aria-labelledby="photos-title">
        <div className="section-head">
          <h2 id="photos-title">Progress photos</h2>
          <div className="head-actions">
            {photos.length > 1 ? (
              <>
                <label className="inline-select">
                  <span className="faint">Before</span>
                  <select className="input" value={before?.id ?? ''} onChange={(e) => setBeforeId(Number(e.target.value))}>
                    {photos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatDayMonthYear(p.date)}
                        {p.pose ? `, ${p.pose}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-select">
                  <span className="faint">After</span>
                  <select className="input" value={after?.id ?? ''} onChange={(e) => setAfterId(Number(e.target.value))}>
                    {photos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatDayMonthYear(p.date)}
                        {p.pose ? `, ${p.pose}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <button className="btn btn-sm" onClick={() => openEditor({ kind: 'photo' })}>
              <IconPlus /> Add photo
            </button>
          </div>
        </div>
        <PhotoPair data={data} first={before} last={after} />
        {photos.length > 2 ? (
          <div className="thumbs">
            {photos.map((p) => (
              <button key={p.id} className="thumb" onClick={() => openEditor({ kind: 'photo', id: p.id })} title={formatDayMonthYear(p.date)}>
                <img src={p.url} alt={`Progress photo, ${formatDayMonthYear(p.date)}`} loading="lazy" />
                <span>{formatShort(p.date)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="section" aria-labelledby="weighins-title">
        <div className="section-head">
          <h2 id="weighins-title">Weigh-ins</h2>
          <button className="btn btn-sm" onClick={() => openEditor({ kind: 'day' })}>
            Add a weigh-in
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                <th className="r">Weighed</th>
                <th className="r">Trend</th>
                <th className="r">Off trend</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((w) => {
                const t = trendByDate.get(w.date)!;
                const open = () => openEditor({ kind: 'day', date: w.date });
                return (
                  <tr key={w.date} tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()}>
                    <td>
                      <strong>{formatDow(w.date)}</strong> <span className="muted">{formatDayMonthYear(w.date)}</span>
                    </td>
                    <td className="r day-weight day-eaten">{kg(w.kg)} kg</td>
                    <td className="r weigh-trend">{kg(t)}</td>
                    <td className="r muted">{signed(w.kg - t)}</td>
                    <td className="muted">{w.source === 'import' ? 'Old dashboard' : w.source === 'chat' ? 'Claude' : 'Dashboard'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {weighIns.length > 12 ? (
          <button className="btn btn-quiet show-more" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Show fewer' : `Show all ${weighIns.length}`}
          </button>
        ) : null}
      </section>
    </>
  );
}
