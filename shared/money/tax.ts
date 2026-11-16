// Tax years. Australia's runs 1 July to 30 June and is written "2025-26";
// the US one is the calendar year, written "2025".

import type { DateStr } from '../dates.ts';

export const COUNTRIES = ['AU', 'US'] as const;
export type Country = (typeof COUNTRIES)[number];
export const COUNTRY_NAMES: Record<Country, string> = { AU: 'Australia', US: 'United States' };

/** "2025-26" for any day from 1 July 2025 to 30 June 2026. */
export function auTaxYear(date: DateStr): string {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 7 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const usTaxYear = (date: DateStr) => date.slice(0, 4);

export const taxYearOf = (country: Country, date: DateStr) => (country === 'AU' ? auTaxYear(date) : usTaxYear(date));

/** First and last day of a tax year label. */
export function taxYearRange(country: Country, label: string): [DateStr, DateStr] {
  if (country === 'US') return [`${label}-01-01`, `${label}-12-31`];
  const start = Number(label.slice(0, 4));
  return [`${start}-07-01`, `${start + 1}-06-30`];
}

export function isTaxYear(country: Country, label: string): boolean {
  if (country === 'US') return /^\d{4}$/.test(label);
  const m = label.match(/^(\d{4})-(\d{2})$/);
  return !!m && (Number(m[1]) + 1) % 100 === Number(m[2]);
}

/** Money is stored in cents and shown with its currency. */
export function money(cents: number | null | undefined, currency: string = 'AUD'): string {
  if (cents == null) return '–';
  const v = cents / 100;
  const s = new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v));
  return `${v < 0 ? '−' : ''}${currency === 'USD' ? 'US$' : '$'}${s}`;
}
