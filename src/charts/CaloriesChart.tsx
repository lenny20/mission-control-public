import { scaleBand, scaleLinear } from 'd3-scale';
import { useId, useState } from 'react';
import { formatDow, formatLong, formatShort, type DateStr } from '../../shared/dates.ts';
import { belowTarget } from '../../shared/health/metrics.ts';
import type { NutritionDay } from '../../shared/health/types.ts';
import { kcal } from '../lib/format.ts';
import { useWidth } from '../lib/hooks.ts';

/**
 * Calories eaten each day against that day's target (exercise added back,
 * as Macrau does). The bar is what was eaten; the white tick is the target.
 * Amber means over target.
 */
export function CaloriesChart({ days, byDate, height = 220, onPick }: { days: DateStr[]; byDate: Map<DateStr, NutritionDay>; height?: number; onPick?: (d: DateStr) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<DateStr | null>(null);
  const id = useId();
  const m = { top: 12, right: 4, bottom: 28, left: 40 };
  const innerW = Math.max(0, width - m.left - m.right);
  const innerH = height - m.top - m.bottom;

  const logged = days.map((d) => byDate.get(d)).filter((n): n is NutritionDay => !!n);
  const max = Math.max(1000, ...logged.map((n) => Math.max(n.eatenKcal, (n.targetKcal ?? 0) + n.burnedKcal)));
  const x = scaleBand<DateStr>().domain(days).range([0, innerW]).paddingInner(0.28).paddingOuter(0.1);
  const y = scaleLinear().domain([0, max * 1.06]).nice(4).range([innerH, 0]);
  const bw = Math.min(24, x.bandwidth());
  const labelEvery = Math.ceil(days.length / Math.max(2, Math.floor(innerW / 64)));

  const active = hover ? byDate.get(hover) : null;

  return (
    <div className="chart health-chart" ref={ref} style={{ height }}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label="Calories eaten each day against target">
          <defs>
            {[
              ['under', 'var(--calories)'],
              ['over', 'var(--over)'],
            ].map(([k, c]) => (
              <linearGradient key={k} id={`${id}${k}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={c} />
                <stop offset="100%" stopColor={c} stopOpacity={0.35} />
              </linearGradient>
            ))}
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
                  {t >= 1000 ? `${t / 1000}k` : t}
                </text>
              ))}
              {days.map((d, i) =>
                (days.length - 1 - i) % labelEvery === 0 ? (
                  <text key={d} x={(x(d) ?? 0) + x.bandwidth() / 2} y={innerH + 18} textAnchor="middle">
                    {i === days.length - 1 ? 'Today' : formatShort(d)}
                  </text>
                ) : null,
              )}
            </g>
            {days.map((d) => {
              const n = byDate.get(d);
              const cx = (x(d) ?? 0) + x.bandwidth() / 2;
              const isHover = hover === d;
              if (!n) {
                return <circle key={d} cx={cx} cy={innerH - 2} r={1.6} fill="var(--text-3)" opacity={0.6} />;
              }
              const target = n.targetKcal != null ? n.targetKcal + n.burnedKcal : null;
              const over = target != null && n.eatenKcal > target;
              const top = y(n.eatenKcal);
              const h = innerH - top;
              const r = Math.min(4, h / 2, bw / 2);
              return (
                <g key={d}>
                  <path
                    d={`M${cx - bw / 2},${innerH} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${innerH} Z`}
                    fill={`url(#${id}${over ? 'over' : 'under'})`}
                    className="bar"
                    opacity={hover && !isHover ? 0.45 : 1}
                    style={{ '--c': over ? 'var(--over)' : 'var(--calories)' } as React.CSSProperties}
                  />
                  {target != null ? <line className="target-tick" x1={cx - bw / 2 - 3} x2={cx + bw / 2 + 3} y1={y(target)} y2={y(target)} stroke="var(--text)" strokeWidth={2} strokeLinecap="round" /> : null}
                </g>
              );
            })}
            {/* Hit areas: the whole column, not just the painted bar. */}
            {days.map((d) => (
              <rect
                key={`hit${d}`}
                x={x(d)! - (x.step() - x.bandwidth()) / 2}
                y={0}
                width={x.step()}
                height={innerH}
                fill="transparent"
                tabIndex={byDate.has(d) ? 0 : -1}
                aria-label={byDate.has(d) ? `${formatLong(d)}: ${kcal(byDate.get(d)!.eatenKcal)} calories` : undefined}
                onPointerEnter={() => setHover(d)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(d)}
                onBlur={() => setHover(null)}
                onClick={() => onPick?.(d)}
                onKeyDown={(e) => e.key === 'Enter' && onPick?.(d)}
                style={{ cursor: onPick ? 'pointer' : 'default', outline: 'none' }}
              />
            ))}
          </g>
        </svg>
      ) : null}
      {hover ? (
        <div className="tip" style={{ left: m.left + (x(hover) ?? 0) + x.bandwidth() / 2, top: m.top + (active ? y(Math.max(active.eatenKcal, (active.targetKcal ?? 0) + active.burnedKcal)) : innerH) }}>
          <div className="tip-date">
            {formatDow(hover)} {formatShort(hover)}
          </div>
          {active ? (
            <>
              <div className="tip-row">
                <strong className="num">{kcal(active.eatenKcal)}</strong>
                <span>eaten{active.targetKcal != null ? ` of ${kcal(active.targetKcal + active.burnedKcal)}` : ''}</span>
              </div>
              {belowTarget(active) != null ? (
                <div className="tip-row">
                  <span>{belowTarget(active)! >= 0 ? `${kcal(belowTarget(active))} under` : `${kcal(-belowTarget(active)!)} over`}</span>
                </div>
              ) : null}
            </>
          ) : (
            <div className="tip-row">
              <span>Not logged</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
