// The checks every Money write goes through, from chat or the dashboard.

import { z } from 'zod';
import { dateStr } from '../health/schemas.ts';
import { COUNTRIES, isTaxYear, type Country } from './tax.ts';

export const CURRENCIES = ['AUD', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Expense categories offered by default. Any other is allowed. */
export const EXPENSE_CATEGORIES = [
  'Software & subscriptions',
  'Equipment',
  'Home office',
  'Phone & internet',
  'Travel',
  'Meals & entertainment',
  'Script & research materials',
  'Industry memberships',
  'Courses & training',
  'Accounting & tax',
  'Other',
];

/** Kinds of tax document offered by default. Any other is allowed. */
export const VAULT_TYPES = ['Tax return', 'Notice of assessment', 'Accountant letter', 'ATO letter', 'IRS letter', 'W-8BEN', '1099-NEC', '1099-MISC', '1042-S', 'Payment summary', 'Other'];

/** A dollar amount from chat or a form, stored as whole cents. */
export const amount = (what: string) =>
  z
    .number({ error: `${what} needs to be a number.` })
    .min(0, `${what} can't be negative.`)
    .max(10_000_000, `${what} over 10 million looks like a typo.`)
    .transform((v) => Math.round(v * 100));

const text = (max: number, what: string) =>
  z
    .string()
    .max(max, `Keep the ${what} under ${max.toLocaleString('en-AU')} characters.`)
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null));
const required = (max: number, what: string) => z.string({ error: `Say what the ${what} is.` }).trim().min(1, `Say what the ${what} is.`).max(max, `Keep the ${what} under ${max} characters.`);

const incomeFields = {
  payer: required(200, 'payer'),
  description: text(500, 'description'),
  /** A Film & TV card it was for. */
  cardId: z.number().int().positive().nullable(),
  country: z.enum(COUNTRIES, { error: 'The country is AU or US.' }),
  currency: z.enum(CURRENCIES, { error: 'The currency is AUD or USD.' }),
  amount: amount('The amount'),
  invoiceNumber: text(60, 'invoice number'),
  invoiceDate: dateStr,
  dueDate: dateStr.nullable(),
  paidDate: dateStr.nullable(),
  /** The Australian dollars that actually arrived. */
  receivedAud: amount('The AUD received').nullable(),
  /** US tax withheld, in the invoice's currency. */
  withheld: amount('The tax withheld').nullable(),
  notes: text(4_000, 'notes'),
};

export const incomeInput = z.object({
  ...incomeFields,
  description: incomeFields.description.default(null),
  cardId: incomeFields.cardId.default(null),
  country: incomeFields.country.default('AU'),
  currency: incomeFields.currency.default('AUD'),
  invoiceNumber: incomeFields.invoiceNumber.default(null),
  dueDate: incomeFields.dueDate.default(null),
  paidDate: incomeFields.paidDate.default(null),
  receivedAud: incomeFields.receivedAud.default(null),
  withheld: incomeFields.withheld.default(null),
  notes: incomeFields.notes.default(null),
});
export const incomePatch = z.object(incomeFields).partial().strict();

const expenseFields = {
  date: dateStr,
  supplier: required(200, 'supplier'),
  description: text(500, 'description'),
  currency: z.enum(CURRENCIES, { error: 'The currency is AUD or USD.' }),
  amount: amount('The amount'),
  /** GST included in the amount, when the receipt shows it. */
  gst: amount('The GST').nullable(),
  category: required(80, 'category'),
  country: z.enum(COUNTRIES, { error: 'The country is AU or US.' }),
  notes: text(4_000, 'notes'),
};

export const expenseInput = z.object({
  ...expenseFields,
  description: expenseFields.description.default(null),
  currency: expenseFields.currency.default('AUD'),
  gst: expenseFields.gst.default(null),
  category: expenseFields.category.default('Other'),
  country: expenseFields.country.default('AU'),
  notes: expenseFields.notes.default(null),
});
export const expensePatch = z.object(expenseFields).partial().strict();

const vaultFields = {
  title: required(200, 'title'),
  country: z.enum(COUNTRIES, { error: 'The country is AU or US.' }),
  /** In the country's own terms: "2025-26" for Australia, "2025" for the US. */
  taxYear: z.string({ error: 'Give the tax year.' }).trim(),
  type: required(80, 'type'),
  issuer: text(200, 'issuer'),
  expires: dateStr.nullable(),
  notes: text(4_000, 'notes'),
};

/** What's wrong with a tax year label for its country, or null. */
export function taxYearProblem(country: Country, taxYear: string): string | null {
  if (isTaxYear(country, taxYear)) return null;
  return country === 'AU' ? 'An Australian tax year is written like 2025-26.' : 'A US tax year is written like 2025.';
}

export const vaultInput = z
  .object({
    ...vaultFields,
    issuer: vaultFields.issuer.default(null),
    expires: vaultFields.expires.default(null),
    notes: vaultFields.notes.default(null),
  })
  .superRefine((v, ctx) => {
    const problem = taxYearProblem(v.country, v.taxYear);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });
export const vaultPatch = z.object(vaultFields).partial().strict();
