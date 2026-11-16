import { scaleBand, scaleLinear } from 'd3-scale';
import { useState } from 'react';
import { addDays, type DateStr } from '../../shared/dates.ts';
import { money } from '../../shared/money/tax.ts';
import type { Expense, Income } from '../../shared/money/types.ts';
import { useWidth } from '../lib/hooks.ts';

/** In and out: checked against the dark surface with the dataviz palette validator (both in band, CVD ΔE 26). */
export const MONEY_IN = '#24a94b';
export const MONEY_OUT = '#6f7ff5';

const monthName = new Intl.DateTimeFormat('en-AU', { month: 'short', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

type Month = { key: string; start: DateStr; label: string; long: string; inAud: number; outAud: number };

/** The twelve months of a tax year (from its first day), each with the AUD received and spent. */
export function monthsOf(from: DateStr, income: Income[], expenses: Expense[]): Month[] {
  const months: Month[] = [];
  let d = from;
  for (let i = 0; i < 12; i++) {
    const key = d.slice(0, 7);
    const at = new Date(`${d}T00:00:00Z`);
    months.push({ key, start: d, label: monthName.format(at), long: monthLong.format(at), inAud: 0, outAud: 0 });
    // Four days past the 28th is always in the next month; take its first.
    d = `${addDays(`${key}-28`, 4).slice(0, 7)}-01`;
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const i of income) {
    const mo = i.paidDate ? byKey.get(i.paidDate.slice(0, 7)) : undefined;
    if (mo && i.receivedAud) mo.inAud += i.receivedAud;
  }
  for (const e of expenses) {
    const mo = byKey.get(e.date.slice(0, 7));
    if (mo && e.currency === 'AUD') mo.outAud += e.amount;
  }
  return months;
}

const compact = (cents: number) => {
  const v = cents / 100;
  return v >= 1000 ? `$${(v / 1000).toLocaleString('en-AU', { maximumFractionDigits: 1 })}K` : `$${v}`;
};

/**
 * Money in and out, month by month across the tax year, in Australian
 * dollars. Two columns a month, in then out; hovering a month reads both.
 */
export function MoneyChart({ months, current, height = 240 }: { months: Month[]; current: string | null; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const m = { top: 14, right: 4, bottom: 28, left: 48 };
  const innerW = Math.max(0, width - m.left - m.right);
  const innerH = height - m.top - m.bottom;
  const max = Math.max(100_000, ...months.map((x) => Math.max(x.inAud, x.outAud)));
  const x = scaleBand<string>().domain(months.map((x) => x.key)).range([0, innerW]).paddingInner(0.3).paddingOuter(0.1);
  const y = scaleLinear().domain([0, max * 1.08]).nice(4).range([innerH, 0]);
  // Two columns side by side, each at most 14px, a 2px gap of surface between them.
  const bw = Math.max(3, Math.min(14, (x.bandwidth() - 2) / 2));
  const active = months.find((x) => x.key === hover);

  const column = (cx: number, value: number, fill: string, dim: boolean) => {
    if (!value) return null;
    const top = y(value);
    const h = innerH - top;
    const r = Math.min(4, h / 2, bw / 2);
    return <path d={`M${cx},${innerH} V${top + r} Q${cx},${top} ${cx + r},${top} H${cx + bw - r} Q${cx + bw},${top} ${cx + bw},${top + r} V${innerH} Z`} fill={fill} opacity={dim ? 0.45 : 1} />;
  };

  return (
    <div className="chart money-chart" ref={ref} style={{ height }}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label="Money received and spent each month of the tax year">
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
              {months.map((mo) => (
                <text key={mo.key} x={(x(mo.key) ?? 0) + x.bandwidth() / 2} y={innerH + 18} textAnchor="middle" className={mo.key === current ? 'axis-now' : undefined}>
                  {mo.label}
                </text>
              ))}
            </g>
            {months.map((mo) => {
              const mid = (x(mo.key) ?? 0) + x.bandwidth() / 2;
              const dim = hover != null && hover !== mo.key;
              return (
                <g key={mo.key}>
                  {column(mid - bw - 1, mo.inAud, MONEY_IN, dim)}
                  {column(mid + 1, mo.outAud, MONEY_OUT, dim)}
                </g>
              );
            })}
            {months.map((mo) => (
              <rect
                key={`hit${mo.key}`}
                x={x(mo.key)! - (x.step() - x.bandwidth()) / 2}
                y={0}
                width={x.step()}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${mo.long}: ${money(mo.inAud)} in, ${money(mo.outAud)} out`}
                onPointerEnter={() => setHover(mo.key)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(mo.key)}
                onBlur={() => setHover(null)}
                style={{ outline: 'none' }}
              />
            ))}
          </g>
        </svg>
      ) : null}
      {active ? (
        <div className="tip" style={{ left: m.left + (x(active.key) ?? 0) + x.bandwidth() / 2, top: m.top + y(Math.max(active.inAud, active.outAud)) }}>
          <div className="tip-date">{active.long}</div>
          <div className="tip-row">
            <span className="dot" style={{ background: MONEY_IN }} />
            <strong className="num">{money(active.inAud)}</strong>
            <span>in</span>
          </div>
          <div className="tip-row">
            <span className="dot" style={{ background: MONEY_OUT }} />
            <strong className="num">{money(active.outAud)}</strong>
            <span>out</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
