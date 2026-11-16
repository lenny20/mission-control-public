import { daysBetween } from '../../shared/dates.ts';
import { formsToFlag } from '../../shared/money/flags.ts';
import { auTaxYear, money } from '../../shared/money/tax.ts';
import type { MoneySnapshot } from '../../shared/money/types.ts';


export const overdue = (s: MoneySnapshot) => s.income.filter((i) => !i.paidDate && i.dueDate && i.dueDate < s.today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));

export const expiring = (s: MoneySnapshot) => formsToFlag(s.vault, s.today);

/** Plain notices for Today. */
export function moneyNotices(s: MoneySnapshot | null): { key: string; text: string; href: string; kind: 'money' | 'form' }[] {
  if (!s) return [];
  return [
    ...overdue(s).map((i) => ({
      key: `inc${i.id}`,
      kind: 'money' as const,
      text: `${money(i.amount, i.currency)} from ${i.payer} was due ${ago(daysBetween(i.dueDate!, s.today))}`,
      href: `#/money/income/${i.id}`,
    })),
    ...expiring(s).map((v) => {
      const d = daysBetween(s.today, v.expires!);
      return { key: `vault${v.id}`, kind: 'form' as const, text: `${v.title} ${d < 0 ? `expired ${ago(-d)}` : d === 0 ? 'expires today' : `expires in ${d === 1 ? '1 day' : `${d} days`}`}`, href: `#/money/vault/${v.id}` };
    }),
  ];
}

const ago = (n: number) => (n === 1 ? 'yesterday' : `${n} days ago`);

/** Every tax year with something in it, plus the current one, newest first. */
export function taxYears(s: MoneySnapshot): string[] {
  const years = new Set([auTaxYear(s.today), ...s.income.map((i) => i.auTaxYear), ...s.expenses.map((e) => e.auTaxYear)]);
  return [...years].sort().reverse();
}

/**
 * Dollars typed in a form, as the number the API wants; '' is null. Anything
 * that isn't a number goes as typed, so the server says what's wrong rather
 * than it quietly saving as blank.
 */
export function toDollars(v: string): number | string | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : v;
}
export const fromCents = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
