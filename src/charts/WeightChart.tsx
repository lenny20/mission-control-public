import { scaleLinear, scaleUtc } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import { useId, useMemo, useState } from 'react';
import { addDays, daysBetween, formatDayMonthYear, type DateStr } from '../../shared/dates.ts';
import type { TrendPoint } from '../../shared/health/metrics.ts';
import { kg } from '../lib/format.ts';
import { useWidth } from '../lib/hooks.ts';

const toDate = (d: DateStr) => new Date(`${d}T00:00:00Z`);
/** A break longer than this splits the trend line: no pretending we know what happened. */
const GAP_DAYS = 28;

type Props = {
  points: TrendPoint[];
  from: DateStr | null;
  to: DateStr;
  height?: number;
  onPick?: (date: DateStr) => void;
};

export function WeightChart({ points, from, to, height = 300, onPick }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const gradId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const visible = useMemo(() => points.filter((p) => (!from || p.date >= from) && p.date <= to), [points, from, to]);

  const m = { top: 20, right: 16, bottom: 30, left: 40 };
  const innerW = Math.max(0, width - m.left - m.right);
  const innerH = height - m.top - m.bottom;

  const geo = useMemo(() => {
    if (!visible.length || innerW <= 0) return null;
    const start = from && from < visible[0]!.date ? from : visible[0]!.date;
    const end = to;
    const x = scaleUtc().domain([toDate(start), toDate(end)]).range([0, innerW]);
    const values = visible.flatMap((p) => [p.kg, p.trend]);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    // Hug the data: whole kilos just beyond the extremes, never padded out to a round 70.
    const pad = Math.max(0.3, (hi - lo) * 0.06);
    const y = scaleLinear().domain([Math.floor(lo - pad), Math.ceil(hi + pad)]).range([innerH, 0]);

    // Split into runs wherever weigh-ins stop for a while.
    const runs: TrendPoint[][] = [];
    const gaps: { a: DateStr; b: DateStr }[] = [];
    for (const p of visible) {
      const run = runs.at(-1);
      const prev = run?.at(-1);
      if (!run || !prev || daysBetween(prev.date, p.date) > GAP_DAYS) {
        if (prev) gaps.push({ a: prev.date, b: p.date });
        runs.push([p]);
      } else run.push(p);
    }
    const lineGen = line<TrendPoint>()
      .x((p) => x(toDate(p.date)))
      .y((p) => y(p.trend))
      .curve(curveMonotoneX);
    const areaGen = area<TrendPoint>()
      .x((p) => x(toDate(p.date)))
      .y0(innerH)
      .y1((p) => y(p.trend))
      .curve(curveMonotoneX);

    const spanDays = daysBetween(start, end);
    const xTicks = x.ticks(Math.max(2, Math.min(spanDays > 500 ? 6 : 8, Math.floor(innerW / 110))));
    const tickFmt = new Intl.DateTimeFormat('en-AU', spanDays > 500 ? { month: 'short', year: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' });

    let hiP = visible[0]!;
    let loP = visible[0]!;
    for (const p of visible) {
      if (p.kg > hiP.kg) hiP = p;
      if (p.kg < loP.kg) loP = p;
    }
    return { x, y, runs, gaps, lineGen, areaGen, xTicks, tickFmt, hiP, loP };
  }, [visible, from, to, innerW, innerH]);

  if (!visible.length) {
    return (
      <div className="empty" style={{ height }}>
        <strong>No weigh-ins in this range.</strong>
        Send Claude a Macrau recap and your weight lands here.
      </div>
    );
  }

  const latest = visible.at(-1)!;
  const active = hover != null ? visible[hover] : null;

  const pick = (clientX: number, rect: DOMRect) => {
    if (!geo) return;
    const t = geo.x.invert(clientX - rect.left - m.left).getTime();
    let best = 0;
    let bestDist = Infinity;
    visible.forEach((p, i) => {
      const d = Math.abs(toDate(p.date).getTime() - t);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const cur = hover ?? visible.length - 1;
    if (e.key === 'ArrowLeft') setHover(Math.max(0, cur - 1));
    else if (e.key === 'ArrowRight') setHover(Math.min(visible.length - 1, cur + 1));
    else if (e.key === 'Enter' && active && onPick) onPick(active.date);
    else return;
    e.preventDefault();
  };

  return (
    <div className="chart weight-chart health-chart" ref={ref} style={{ height }}>
      {geo && width > 0 ? (
        <>
          <svg
            width={width}
            height={height}
            tabIndex={0}
            role="img"
            aria-label={`Weight from ${formatDayMonthYear(visible[0]!.date)} to ${formatDayMonthYear(latest.date)}: ${kg(visible[0]!.kg)} kg to ${kg(latest.kg)} kg. Use the arrow keys to read each weigh-in.`}
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
            onKeyDown={onKey}
            onClick={() => active && onPick?.(active.date)}
            style={{ cursor: onPick ? 'pointer' : 'crosshair', outline: 'none' }}
          >
            <defs>
              <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--weight)" stopOpacity={0.3} />
                <stop offset="55%" stopColor="var(--weight)" stopOpacity={0.08} />
                <stop offset="100%" stopColor="var(--weight)" stopOpacity={0} />
              </linearGradient>
              <filter id={`${gradId}glow`} x="-5%" y="-30%" width="110%" height="160%">
                <feGaussianBlur stdDeviation="5" />
              </filter>
              <pattern id={`${gradId}gap`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(255 255 255 / 0.05)" strokeWidth="2" />
              </pattern>
            </defs>
            <g transform={`translate(${m.left},${m.top})`}>
              <g className="grid">
                {geo.y.ticks(5).map((t) => (
                  <line key={t} x1={0} x2={innerW} y1={geo.y(t)} y2={geo.y(t)} />
                ))}
              </g>
              <g className="axis">
                {geo.y.ticks(5).map((t) => (
                  <text key={t} x={-10} y={geo.y(t)} dy="0.32em" textAnchor="end">
                    {t}
                  </text>
                ))}
                {geo.xTicks.map((t) => (
                  <text key={t.toISOString()} x={geo.x(t)} y={innerH + 20} textAnchor="middle">
                    {geo.tickFmt.format(t)}
                  </text>
                ))}
              </g>

              {/* Long breaks in weigh-ins, shown honestly rather than bridged. */}
              {geo.gaps.map((g) => {
                const x0 = geo.x(toDate(addDays(g.a, 2)));
                const x1 = geo.x(toDate(addDays(g.b, -2)));
                const w = x1 - x0;
                return w > 4 ? (
                  <g key={g.a}>
                    <rect x={x0} y={0} width={w} height={innerH} fill={`url(#${gradId}gap)`} rx={6} />
                    {w > 84 ? (
                      <text x={x0 + w / 2} y={14} textAnchor="middle" className="gap-label">
                        no weigh-ins
                      </text>
                    ) : null}
                  </g>
                ) : null;
              })}

              {geo.runs.map((run) => (
                <path key={`a${run[0]!.date}`} d={geo.areaGen(run) ?? ''} fill={`url(#${gradId})`} />
              ))}

              {visible.map((p) => (
                <circle key={p.date} cx={geo.x(toDate(p.date))} cy={geo.y(p.kg)} r={2.2} fill="var(--weight)" opacity={0.34} />
              ))}

              {/* The trend line, with its own light beneath it. */}
              {geo.runs.map((run) =>
                run.length > 1 ? (
                  <g key={`l${run[0]!.date}`}>
                    <path d={geo.lineGen(run) ?? ''} fill="none" stroke="var(--weight)" strokeWidth={5} strokeOpacity={0.55} filter={`url(#${gradId}glow)`} />
                    <path d={geo.lineGen(run) ?? ''} fill="none" stroke="var(--weight)" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                ) : null,
              )}

              {/* Selective labels: the range's high and low. */}
              {geo.hiP !== geo.loP
                ? [
                    { p: geo.hiP, dy: -10 },
                    { p: geo.loP, dy: 18 },
                  ].map(({ p, dy }) => {
                    // Near either edge, set the label inward so it never sits on the axis.
                    const px = geo.x(toDate(p.date));
                    const anchor = px < 28 ? 'start' : px > innerW - 28 ? 'end' : 'middle';
                    const dx = anchor === 'start' ? 6 : anchor === 'end' ? -6 : 0;
                    return (
                      <text key={`x${p.date}`} x={px + dx} y={geo.y(p.kg) + dy} textAnchor={anchor} className="extreme-label">
                        {kg(p.kg)}
                      </text>
                    );
                  })
                : null}

              {/* The latest weigh-in, lit. */}
              <circle cx={geo.x(toDate(latest.date))} cy={geo.y(latest.kg)} r={13} fill="var(--weight)" opacity={0.14} />
              <circle cx={geo.x(toDate(latest.date))} cy={geo.y(latest.kg)} r={8} fill="var(--weight)" opacity={0.22} />
              <circle cx={geo.x(toDate(latest.date))} cy={geo.y(latest.kg)} r={4.5} fill="#ece6ff" stroke="var(--weight)" strokeWidth={2} />

              {active ? (
                <g pointerEvents="none">
                  <line x1={geo.x(toDate(active.date))} x2={geo.x(toDate(active.date))} y1={0} y2={innerH} stroke="rgb(255 255 255 / 0.18)" strokeDasharray="2 3" />
                  <circle cx={geo.x(toDate(active.date))} cy={geo.y(active.trend)} r={4} fill="var(--surface)" stroke="var(--weight)" strokeWidth={2} />
                  <circle cx={geo.x(toDate(active.date))} cy={geo.y(active.kg)} r={5} fill="var(--weight)" stroke="var(--surface)" strokeWidth={2} />
                </g>
              ) : null}
            </g>
          </svg>
          {active ? (
            <div className="tip" style={{ left: m.left + geo.x(toDate(active.date)), top: m.top + Math.min(geo.y(active.kg), geo.y(active.trend)) }}>
              <div className="tip-date">{formatDayMonthYear(active.date)}</div>
              <div className="tip-row">
                <strong className="num">{kg(active.kg)} kg</strong>
                <span>weighed</span>
              </div>
              <div className="tip-row">
                <span className="key-line" style={{ background: 'var(--weight)' }} />
                <span className="num">{kg(active.trend)} kg trend</span>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
