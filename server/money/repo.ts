// The one save path for Money & tax: income owed to the user, expenses with
// their receipts, and the tax vault. Amounts are whole cents.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { DateStr } from '../../shared/dates.ts';
import { taxYearProblem, expenseInput, expensePatch, incomeInput, incomePatch, vaultInput, vaultPatch } from '../../shared/money/schemas.ts';
import { auTaxYear, taxYearOf, usTaxYear, type Country } from '../../shared/money/tax.ts';
import type { Expense, Income, MoneySnapshot, VaultDoc } from '../../shared/money/types.ts';
import { getSetting } from '../calendar/repo.ts';
import { paths } from '../config.ts';
import { transaction, type Db } from '../db.ts';
import { UserError } from '../errors.ts';
import { fileUrl } from '../files.ts';
import * as work from '../work/repo.ts';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const now = () => new Date().toISOString();

export const DEFAULT_EXPORT_DIR = '~/Documents/Mission Control/Exports';
export const exportDir = (db: Db) => getSetting(db, 'money.exportDir') ?? DEFAULT_EXPORT_DIR;

// ------------------------------------------------------------------ files

const DOC_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.pdf']);

function checkDoc(file: string): string {
  if (!existsSync(file)) throw new UserError(`No file at ${file}`);
  const ext = path.extname(file).toLowerCase();
  if (!DOC_EXTS.has(ext)) throw new UserError(`${path.basename(file)} isn't a kind of file this can keep (a photo or a PDF).`);
  return ext === '.jpeg' ? '.jpg' : ext;
}

/**
 * Receipts, invoices and remittances are stored by content, so the same
 * screenshot sent twice is kept once. Returns the path under files/.
 */
function storeDocFile(file: string): string {
  const ext = checkDoc(file);
  mkdirSync(paths.receipts, { recursive: true });
  const name = `${createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)}${ext}`;
  const dest = path.join(paths.receipts, name);
  if (!existsSync(dest)) copyFileSync(file, dest);
  return `receipts/${name}`;
}

/** Safe in a file name on any system. */
const fileSafe = (s: string) => s.replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';

/** Vault documents get a readable name: "AU 2025-26/Notice of assessment.pdf". */
function storeVaultDoc(file: string, country: Country, taxYear: string, title: string): string {
  const ext = checkDoc(file);
  const folder = `${country} ${taxYear}`;
  mkdirSync(path.join(paths.vault, folder), { recursive: true });
  for (let n = 1; ; n++) {
    const rel = path.join(folder, `${fileSafe(title)}${n === 1 ? '' : ` ${n}`}${ext}`);
    if (!existsSync(path.join(paths.vault, rel))) {
      copyFileSync(file, path.join(paths.vault, rel));
      return `vault/${rel}`;
    }
  }
}

// ------------------------------------------------------------------ income

function rowToIncome(r: Row): Income {
  const country = r.country as Country;
  const counted = String(r.paid_date ?? r.invoice_date);
  return {
    id: Number(r.id),
    payer: String(r.payer),
    description: str(r.description),
    cardId: num(r.card_id),
    country,
    currency: r.currency as Income['currency'],
    amount: Number(r.amount),
    invoiceNumber: str(r.invoice_number),
    invoiceDate: String(r.invoice_date),
    dueDate: str(r.due_date),
    paidDate: str(r.paid_date),
    receivedAud: r.received_aud != null ? Number(r.received_aud) : r.paid_date && r.currency === 'AUD' ? Number(r.amount) - Number(r.withheld ?? 0) : null,
    receivedAudGiven: num(r.received_aud),
    withheld: num(r.withheld),
    notes: str(r.notes),
    source: fileUrl(str(r.source_file)),
    auTaxYear: auTaxYear(counted),
    usTaxYear: country === 'US' ? usTaxYear(counted) : null,
  };
}

export function listIncome(db: Db): Income[] {
  return (db.prepare('SELECT * FROM income ORDER BY invoice_date DESC, id DESC').all() as Row[]).map(rowToIncome);
}

export function getIncome(db: Db, id: number): Income {
  const r = db.prepare('SELECT * FROM income WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new UserError(`There's no income entry ${id}.`, 404);
  return rowToIncome(r);
}

type IncomeFields = Omit<Income, 'id' | 'auTaxYear' | 'usTaxYear' | 'receivedAudGiven' | 'source'>;

/** `receivedAud` here is what was entered: for AUD, null means "the amount less tax withheld". */
function checkIncome(db: Db, i: IncomeFields) {
  if (i.dueDate && i.dueDate < i.invoiceDate) throw new UserError("The due date can't be before the invoice date.");
  if (i.paidDate && i.paidDate < i.invoiceDate) throw new UserError("It can't be paid before it was invoiced.");
  if (!i.paidDate && (i.receivedAud != null || i.withheld != null)) throw new UserError('Add the paid date along with what was received.');
  // No exchange rate is guessed: a foreign payment needs the Australian dollars that actually arrived.
  if (i.currency !== 'AUD' && i.paidDate && i.receivedAud == null) throw new UserError('Add the Australian dollars that actually arrived (receivedAud) for a USD payment.');
  if (i.withheld != null && i.withheld > i.amount) throw new UserError("More tax withheld than the invoice's amount looks like a typo.");
  if (i.cardId != null) {
    const card = work.getCard(db, i.cardId);
    if (card.board !== 'film') throw new UserError('Income links to Film & TV projects, not software cards.');
  }
}

export function addIncome(db: Db, raw: unknown, sourceFile: string | null = null): Income {
  const i = incomeInput.parse(raw);
  checkIncome(db, i);
  const source = sourceFile ? storeDocFile(sourceFile) : null;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO income (payer, description, card_id, country, currency, amount, invoice_number, invoice_date, due_date, paid_date, received_aud, withheld, notes, source_file, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(i.payer, i.description, i.cardId, i.country, i.currency, i.amount, i.invoiceNumber, i.invoiceDate, i.dueDate, i.paidDate, i.receivedAud, i.withheld, i.notes, source, now());
  return getIncome(db, Number(lastInsertRowid));
}

export function updateIncome(db: Db, id: number, raw: unknown, sourceFile: string | null = null): Income {
  const patch = incomePatch.parse(raw);
  return transaction(db, () => {
    const stored = getIncome(db, id);
    // Start from what was entered, so a worked-out AUD figure follows later changes to the amount.
    const i = { ...stored, receivedAud: stored.receivedAudGiven, ...patch };
    // Un-marking paid clears what was received with it.
    if (patch.paidDate === null) {
      if (patch.receivedAud === undefined) i.receivedAud = null;
      if (patch.withheld === undefined) i.withheld = null;
    }
    checkIncome(db, i);
    const before = str((db.prepare('SELECT source_file FROM income WHERE id = ?').get(id) as Row).source_file);
    const source = sourceFile ? storeDocFile(sourceFile) : before;
    db.prepare(
      `UPDATE income SET payer = ?, description = ?, card_id = ?, country = ?, currency = ?, amount = ?, invoice_number = ?, invoice_date = ?, due_date = ?, paid_date = ?, received_aud = ?, withheld = ?, notes = ?, source_file = ? WHERE id = ?`,
    ).run(i.payer, i.description, i.cardId, i.country, i.currency, i.amount, i.invoiceNumber, i.invoiceDate, i.dueDate, i.paidDate, i.receivedAud, i.withheld, i.notes, source, id);
    if (sourceFile) dropDocFile(db, before);
    return getIncome(db, id);
  });
}

export function deleteIncome(db: Db, id: number): Income {
  const i = getIncome(db, id);
  const rel = str((db.prepare('SELECT source_file FROM income WHERE id = ?').get(id) as Row).source_file);
  db.prepare('DELETE FROM income WHERE id = ?').run(id);
  dropDocFile(db, rel);
  return i;
}

// ------------------------------------------------------------------ expenses

const rowToExpense = (r: Row): Expense => ({
  id: Number(r.id),
  date: String(r.date),
  supplier: String(r.supplier),
  description: str(r.description),
  currency: r.currency as Expense['currency'],
  amount: Number(r.amount),
  gst: num(r.gst),
  category: String(r.category),
  country: r.country as Country,
  notes: str(r.notes),
  receipt: fileUrl(str(r.receipt)),
  auTaxYear: auTaxYear(String(r.date)),
});

export function listExpenses(db: Db): Expense[] {
  return (db.prepare('SELECT * FROM expenses ORDER BY date DESC, id DESC').all() as Row[]).map(rowToExpense);
}

export function getExpense(db: Db, id: number): Expense {
  const r = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new UserError(`There's no expense ${id}.`, 404);
  return rowToExpense(r);
}

function checkExpense(e: { amount: number; gst: number | null; currency: string }) {
  if (e.gst != null && e.gst > e.amount) throw new UserError("The GST can't be more than the amount.");
  if (e.gst != null && e.currency !== 'AUD') throw new UserError('GST is only on Australian-dollar expenses.');
}

/** Same supplier, date and amount: almost certainly the same receipt sent twice. */
function findDuplicate(db: Db, e: { date: string; supplier: string; amount: number }, except?: number) {
  return db.prepare('SELECT id FROM expenses WHERE date = ? AND supplier = ? COLLATE NOCASE AND amount = ? AND id IS NOT ?').get(e.date, e.supplier, e.amount, except ?? null) as { id: number } | undefined;
}

export function addExpense(db: Db, raw: unknown, receiptFile: string | null, opts: { allowDuplicate?: boolean } = {}): Expense {
  const e = expenseInput.parse(raw);
  checkExpense(e);
  const dup = findDuplicate(db, e);
  if (dup && !opts.allowDuplicate) throw new UserError(`That looks like expense ${dup.id} again (same supplier, date and amount). If it really is a second one, add it anyway.`, 409);
  const receipt = receiptFile ? storeDocFile(receiptFile) : null;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO expenses (date, supplier, description, currency, amount, gst, category, country, notes, receipt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(e.date, e.supplier, e.description, e.currency, e.amount, e.gst, e.category, e.country, e.notes, receipt, now());
  return getExpense(db, Number(lastInsertRowid));
}

export function updateExpense(db: Db, id: number, raw: unknown, receiptFile: string | null = null): Expense {
  const patch = expensePatch.parse(raw);
  return transaction(db, () => {
    const before = db.prepare('SELECT receipt FROM expenses WHERE id = ?').get(id) as Row | undefined;
    const e = { ...getExpense(db, id), ...patch };
    checkExpense(e);
    const receipt = receiptFile ? storeDocFile(receiptFile) : str(before?.receipt);
    db.prepare('UPDATE expenses SET date = ?, supplier = ?, description = ?, currency = ?, amount = ?, gst = ?, category = ?, country = ?, notes = ?, receipt = ? WHERE id = ?').run(
      e.date,
      e.supplier,
      e.description,
      e.currency,
      e.amount,
      e.gst,
      e.category,
      e.country,
      e.notes,
      receipt,
      id,
    );
    if (receiptFile) dropDocFile(db, str(before?.receipt));
    return getExpense(db, id);
  });
}

/** Delete a stored file once no expense or income entry uses it. */
function dropDocFile(db: Db, rel: string | null) {
  if (!rel || db.prepare('SELECT 1 FROM expenses WHERE receipt = ? UNION SELECT 1 FROM income WHERE source_file = ?').get(rel, rel)) return;
  const file = path.join(paths.files, rel);
  if (existsSync(file)) unlinkSync(file);
}

export function deleteExpense(db: Db, id: number): Expense {
  const e = getExpense(db, id);
  const rel = str((db.prepare('SELECT receipt FROM expenses WHERE id = ?').get(id) as Row).receipt);
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  dropDocFile(db, rel);
  return e;
}

export function categories(db: Db): string[] {
  return (db.prepare('SELECT DISTINCT category FROM expenses ORDER BY category').all() as { category: string }[]).map((r) => r.category);
}

// ------------------------------------------------------------------ vault

const rowToVault = (r: Row): VaultDoc => ({
  id: Number(r.id),
  title: String(r.title),
  country: r.country as Country,
  taxYear: String(r.tax_year),
  type: String(r.type),
  issuer: str(r.issuer),
  expires: str(r.expires),
  notes: str(r.notes),
  file: fileUrl(String(r.file))!,
  path: path.join(paths.files, String(r.file)),
  addedAt: String(r.added_at),
});

export function listVault(db: Db): VaultDoc[] {
  return (db.prepare('SELECT * FROM vault_docs ORDER BY tax_year DESC, country, title').all() as Row[]).map(rowToVault);
}

export function getVaultDoc(db: Db, id: number): VaultDoc {
  const r = db.prepare('SELECT * FROM vault_docs WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new UserError(`There's no tax document ${id}.`, 404);
  return rowToVault(r);
}

export function addVaultDoc(db: Db, file: string, raw: unknown): VaultDoc {
  const v = vaultInput.parse(raw);
  const rel = storeVaultDoc(file, v.country, v.taxYear, v.title);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO vault_docs (title, country, tax_year, type, issuer, expires, notes, file, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(v.title, v.country, v.taxYear, v.type, v.issuer, v.expires, v.notes, rel, now());
  return getVaultDoc(db, Number(lastInsertRowid));
}

/** Change a document's details. A new title, country or year moves its file to match, so names stay readable. Returns the old path too. */
export function updateVaultDoc(db: Db, id: number, raw: unknown): VaultDoc & { movedFrom: string | null } {
  const patch = vaultPatch.parse(raw);
  const before = getVaultDoc(db, id);
  const v = { ...before, ...patch };
  const problem = taxYearProblem(v.country, v.taxYear);
  if (problem) throw new UserError(problem);
  let file = path.relative(paths.files, before.path);
  const moved = v.title !== before.title || v.country !== before.country || v.taxYear !== before.taxYear;
  if (moved && existsSync(before.path)) {
    file = storeVaultDoc(before.path, v.country, v.taxYear, v.title);
    unlinkSync(before.path);
  }
  db.prepare('UPDATE vault_docs SET title = ?, country = ?, tax_year = ?, type = ?, issuer = ?, expires = ?, notes = ?, file = ? WHERE id = ?').run(v.title, v.country, v.taxYear, v.type, v.issuer, v.expires, v.notes, file, id);
  return { ...getVaultDoc(db, id), movedFrom: moved ? before.path : null };
}

/** Tax documents whose details match every word, for doc search (photos of letters aren't readable text). */
export function searchVault(db: Db, q: string): VaultDoc[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return listVault(db).filter((v) => words.every((w) => [v.title, v.type, v.issuer, v.country, v.taxYear, v.notes].some((f) => f?.toLowerCase().includes(w))));
}

/** Tax papers are never destroyed here: the file moves to the vault's hidden .trash folder. */
export function deleteVaultDoc(db: Db, id: number): VaultDoc {
  const v = getVaultDoc(db, id);
  db.prepare('DELETE FROM vault_docs WHERE id = ?').run(id);
  if (existsSync(v.path)) {
    const trash = path.join(paths.vault, '.trash');
    mkdirSync(trash, { recursive: true });
    renameSync(v.path, path.join(trash, `${Date.now()} ${path.basename(v.path)}`));
  }
  return v;
}

// ------------------------------------------------------------------ snapshot

export function snapshot(db: Db, today: DateStr): MoneySnapshot {
  return { today, income: listIncome(db), expenses: listExpenses(db), vault: listVault(db), exportDir: exportDir(db) };
}

export { taxYearOf };
