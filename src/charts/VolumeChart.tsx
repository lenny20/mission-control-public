import { scaleBand, scaleLinear } from 'd3-scale';
import { useId, useState } from 'react';
import { addDays, formatShort } from '../../shared/dates.ts';
import type { WeekVolume } from '../../shared/health/metrics.ts';
import { compact, plural } from '../lib/format.ts';
import { useWidth } from '../lib/hooks.ts';

/** Total weight moved per week (weight × reps). */
export function VolumeChart({ weeks, height = 200 }: { weeks: WeekVolume[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const m = { top: 12, right: 4, bottom: 28, left: 44 };
  const innerW = Math.max(0, width - m.left - m.right);
  const innerH = height - m.top - m.bottom;
  const x = scaleBand<string>().domain(weeks.map((w) => w.week)).range([0, innerW]).paddingInner(0.3).paddingOuter(0.1);
  const y = scaleLinear().domain([0, Math.max(1, ...weeks.map((w) => w.volume)) * 1.08]).nice(4).range([innerH, 0]);
  const bw = Math.min(24, x.bandwidth());
  const every = Math.ceil(weeks.length / Math.max(2, Math.floor(innerW / 70)));
  const active = hover != null ? weeks[hover] : null;

  return (
    <div className="chart health-chart" ref={ref} style={{ height }}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label="Weekly training volume">
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--training)" />
              <stop offset="100%" stopColor="var(--training)" stopOpacity={0.3} />
            </linearGradient>
          </defs>
          <g transform={`translate(${m.left},${m.top})`}>
            <g className="grid">
              {y.ticks(4).map((t) => (
                <line key={t} x1={0} x2={innerW} y1={y(t)} y2={y(t)} />
              ))}
            </g>
            <g className="axis">
              {y.ticks(4).map((t) => (
                <text key={t} x={-10} y={y(t)} dy="0.32em" textAnchor="end">
                  {compact(t)}
                </text>
              ))}
              {weeks.map((w, i) =>
                (weeks.length - 1 - i) % every === 0 ? (
                  <text key={w.week} x={(x(w.week) ?? 0) + x.bandwidth() / 2} y={innerH + 18} textAnchor="middle">
                    {formatShort(w.week)}
                  </text>
                ) : null,
              )}
            </g>
            {weeks.map((w, i) => {
              const cx = (x(w.week) ?? 0) + x.bandwidth() / 2;
              const top = y(w.volume);
              const r = Math.min(4, (innerH - top) / 2);
              return (
                <g key={w.week} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                  <rect x={x(w.week)! - (x.step() - x.bandwidth()) / 2} y={0} width={x.step()} height={innerH} fill="transparent" />
                  <path
                    d={`M${cx - bw / 2},${innerH} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${innerH} Z`}
                    fill={`url(#${id})`}
                    className="bar"
                    style={{ '--c': 'var(--training)' } as React.CSSProperties}
                    opacity={hover != null && hover !== i ? 0.45 : 1}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      ) : null}
      {active ? (
        <div className="tip" style={{ left: m.left + (x(active.week) ?? 0) + x.bandwidth() / 2, top: m.top + y(active.volume) }}>
          <div className="tip-date">
            Week of {formatShort(active.week)} to {formatShort(addDays(active.week, 6))}
          </div>
          <div className="tip-row">
            <strong className="num">{Math.round(active.volume).toLocaleString('en-AU')} kg</strong>
            <span>{plural(active.sets, 'set')}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
