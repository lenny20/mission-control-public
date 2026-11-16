const nf = (max: number, min = 0) => new Intl.NumberFormat('en-AU', { maximumFractionDigits: max, minimumFractionDigits: min });

const int = nf(0);
const one = nf(1, 1);
const upToTwo = nf(2);

/** 2,016 */
export const kcal = (v: number | null | undefined) => (v == null ? '–' : int.format(Math.round(v)));
/** 152 g; keeps decimals only when they matter for a single reading */
export const grams = (v: number | null | undefined) => (v == null ? '–' : int.format(Math.round(v)));
export const gramsExact = (v: number | null | undefined) => (v == null ? '–' : upToTwo.format(v));
/** 78.9 */
export const kg = (v: number | null | undefined) => (v == null ? '–' : one.format(v));
/** Weight lifted: 82.5, 80, 12.5 */
export const load = (v: number | null | undefined) => (v == null ? '–' : upToTwo.format(v));
/** Estimated 1RM, whole kilos like the gym app shows: 79 */
export const oneRm = (v: number | null | undefined) => (v == null ? '–' : int.format(Math.round(v)));
/** −1.2, +0.4 with a real minus sign */
export const signed = (v: number, fmt: (n: number) => string = kg) => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmt(Math.abs(v));
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const compact = (v: number) => new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

export const plural = (n: number, one: string, many = `${one}s`) => `${int.format(n)} ${n === 1 ? one : many}`;
