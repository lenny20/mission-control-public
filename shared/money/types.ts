import type { DateStr } from '../dates.ts';
import type { Currency } from './schemas.ts';
import type { Country } from './tax.ts';

/** Amounts are whole cents. */
export type Income = {
  id: number;
  payer: string;
  description: string | null;
  cardId: number | null;
  country: Country;
  currency: Currency;
  amount: number;
  invoiceNumber: string | null;
  invoiceDate: DateStr;
  dueDate: DateStr | null;
  paidDate: DateStr | null;
  /**
   * The Australian dollars that arrived. For an AUD payment with nothing
   * entered it's the amount less any tax withheld, worked out each time.
   */
  receivedAud: number | null;
  /** What was entered for it, if anything; editing starts from this. */
  receivedAudGiven: number | null;
  withheld: number | null;
  notes: string | null;
  /** The invoice or remittance it was made from, as a /files/ URL. */
  source: string | null;
  /** Australian tax year it counts in: the paid date's, or the invoice date's while unpaid. */
  auTaxYear: string;
  /** For US income, the US tax year as well. */
  usTaxYear: string | null;
};

export type Expense = {
  id: number;
  date: DateStr;
  supplier: string;
  description: string | null;
  currency: Currency;
  amount: number;
  gst: number | null;
  category: string;
  country: Country;
  notes: string | null;
  /** The receipt image or PDF, as a /files/ URL. */
  receipt: string | null;
  auTaxYear: string;
};

export type VaultDoc = {
  id: number;
  title: string;
  country: Country;
  taxYear: string;
  type: string;
  issuer: string | null;
  expires: DateStr | null;
  notes: string | null;
  /** /files/ URL of the document. */
  file: string;
  /** Its path on disk, for the document viewer. */
  path: string;
  addedAt: string;
};

export type MoneySnapshot = { today: DateStr; income: Income[]; expenses: Expense[]; vault: VaultDoc[]; exportDir: string };
