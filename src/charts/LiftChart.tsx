import { scaleLinear, scaleUtc } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import { useId, useState } from 'react';
import { formatDayMonthYear, formatShort, type DateStr } from '../../shared/dates.ts';
import type { Session } from '../../shared/health/metrics.ts';
import { load, oneRm } from '../lib/format.ts';
import { useWidth } from '../lib/hooks.ts';

const toDate = (d: DateStr) => new Date(`${d}T00:00:00Z`);

type Point = { date: DateStr; value: number; pr: boolean };

/** One value per session: estimated 1RM where it exists, otherwise the best set's reps. */
export function sessionPoints(sessions: Session[]): { points: Point[]; metric: 'e1rm' | 'reps' } {
  const withE = sessions.filter((s) => s.bestE1rm != null);
  if (withE.length) {
    return { metric: 'e1rm', points: withE.map((s) => ({ date: s.date, value: s.bestE1rm!, pr: s.sets.some((x) => x.pr) })) };
  }
  return { metric: 'reps', points: sessions.map((s) => ({ date: s.date, value: Math.max(...s.sets.map((x) => x.reps)), pr: s.sets.some((x) => x.pr) })) };
}

export function LiftChart({ sessions, height = 220, compact = false }: { sessions: Session[]; height?: number; compact?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const { points, metric } = sessionPoints(sessions);
  const unit = metric === 'e1rm' ? 'kg' : 'reps';
  const m = compact ? { top: 10, right: 10, bottom: 6, left: 6 } : { top: 16, right: 16, bottom: 28, left: 44 };
  const innerW = Math.max(0, width - m.left - m.right);
  const innerH = height - m.top - m.bottom;

  if (!points.length) return <div ref={ref} style={{ height }} />;

  const first = points[0]!;
  const last = points.at(-1)!;
  const x = scaleUtc()
    .domain(first.date === last.date ? [new Date(toDate(first.date).getTime() - 864e5 * 7), new Date(toDate(last.date).getTime() + 864e5 * 7)] : [toDate(first.date), toDate(last.date)])
    .range([0, innerW]);
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max(1, (hi - lo) * 0.15);
  const y = scaleLinear().domain([lo - pad, hi + pad]).nice(4).range([innerH, 0]);
  const path = line<Point>()
    .x((p) => x(toDate(p.date)))
    .y((p) => y(p.value))
    .curve(curveMonotoneX)(points);
  const fill = area<Point>()
    .x((p) => x(toDate(p.date)))
    .y0(innerH)
    .y1((p) => y(p.value))
    .curve(curveMonotoneX)(points);
  const active = hover != null ? points[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const t = x.invert(e.clientX - e.currentTarget.getBoundingClientRect().left - m.left).getTime();
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(toDate(p.date).getTime() - t) < Math.abs(toDate(points[best]!.date).getTime() - t)) best = i;
    });
    setHover(best);
  };

  return (
    <div className="chart health-chart" ref={ref} style={{ height }}>
      {width > 0 ? (
        <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`${metric === 'e1rm' ? 'Estimated one-rep max' : 'Best reps'} over ${points.length} sessions, latest ${metric === 'e1rm' ? oneRm(last.value) : load(last.value)} ${unit}`}>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--training)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--training)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <g transform={`translate(${m.left},${m.top})`}>
            {!compact ? (
              <>
                <g className="grid">
                  {y.ticks(4).map((t) => (
                    <line key={t} x1={0} x2={innerW} y1={y(t)} y2={y(t)} />
                  ))}
                </g>
                <g className="axis">
                  {y.ticks(4).map((t) => (
                    <text key={t} x={-10} y={y(t)} dy="0.32em" textAnchor="end">
                      {t}
                    </text>
                  ))}
                  {x.ticks(Math.max(2, Math.floor(innerW / 110))).map((t) => (
                    <text key={t.toISOString()} x={x(t)} y={innerH + 20} textAnchor="middle">
                      {formatShort(t.toISOString().slice(0, 10))}
                    </text>
                  ))}
                </g>
              </>
            ) : null}
            {points.length > 1 ? (
              <>
                <path d={fill ?? ''} fill={`url(#${id})`} />
                <path d={path ?? ''} fill="none" stroke="var(--training)" strokeWidth={2} strokeLinecap="round" className="lift-line" />
              </>
            ) : null}
            <circle cx={x(toDate(last.date))} cy={y(last.value)} r={compact ? 9 : 11} fill="var(--training)" opacity={0.18} />
            {points.map((p, i) => (
              <circle
                key={`${p.date}${i}`}
                cx={x(toDate(p.date))}
                cy={y(p.value)}
                r={p.pr ? 5 : compact ? 3 : 4}
                fill={p.pr ? 'var(--surface)' : 'var(--training)'}
                stroke={p.pr ? 'var(--training)' : 'var(--surface)'}
                strokeWidth={2}
              />
            ))}
            {active ? <line x1={x(toDate(active.date))} x2={x(toDate(active.date))} y1={0} y2={innerH} stroke="var(--line-strong)" pointerEvents="none" /> : null}
          </g>
        </svg>
      ) : null}
      {active ? (
        <div className="tip" style={{ left: m.left + x(toDate(active.date)), top: m.top + y(active.value) }}>
          <div className="tip-date">{formatDayMonthYear(active.date)}</div>
          <div className="tip-row">
            <strong className="num">
              {metric === 'e1rm' ? oneRm(active.value) : load(active.value)} {unit}
            </strong>
            <span>{metric === 'e1rm' ? 'est. 1RM' : 'best set'}</span>
          </div>
          {active.pr ? (
            <div className="tip-row">
              <span>Personal record</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
