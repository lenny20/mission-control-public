// The accountant export: for one Australian tax year, a folder holding a
// spreadsheet, every receipt and the year's tax documents, plus a zip of it
// to drop into Google Drive.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { zipSync } from 'fflate';
import { isTaxYear, taxYearRange } from '../../shared/money/tax.ts';
import type { Expense } from '../../shared/money/types.ts';
import { expandHome, paths } from '../config.ts';
import type { Db } from '../db.ts';
import { UserError } from '../errors.ts';
import * as work from '../work/repo.ts';
import { exportDir, listExpenses, listIncome, listVault } from './repo.ts';

const fileSafe = (s: string) => s.replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const dollars = (cents: number | null) => (cents == null ? null : cents / 100);
const MONEY = '#,##0.00';

/** Where the receipt for an expense goes in the export, so the spreadsheet can name it. */
const receiptName = (e: Expense, ext: string) => `${e.date} ${fileSafe(e.supplier)} ${(e.amount / 100).toFixed(2)} (#${e.id})${ext}`;

export async function exportTaxYear(db: Db, fy: string, now = new Date()): Promise<{ folder: string; zip: string; counts: { income: number; expenses: number; receipts: number; documents: number } }> {
  if (!isTaxYear('AU', fy)) throw new UserError('Pick an Australian tax year, written like 2025-26.');
  const [from, to] = taxYearRange('AU', fy);
  const income = listIncome(db).filter((i) => i.auTaxYear === fy).sort((a, b) => (a.paidDate ?? a.invoiceDate).localeCompare(b.paidDate ?? b.invoiceDate));
  const expenses = listExpenses(db).filter((e) => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  // The year's Australian papers, and the US ones for the two calendar years it touches.
  const usYears = [from.slice(0, 4), to.slice(0, 4)];
  const docs = listVault(db).filter((v) => (v.country === 'AU' ? v.taxYear === fy : usYears.includes(v.taxYear)));
  const cards = new Map(work.listCards(db).map((c) => [c.id, c.title]));

  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const base = expandHome(exportDir(db));
  mkdirSync(base, { recursive: true });
  // Every export is a new folder: a second one in the same minute gets " 2", never the first one's folder.
  let folder = '';
  for (let n = 1; ; n++) {
    folder = path.join(base, `Tax ${fy} (exported ${stamp})${n === 1 ? '' : ` ${n}`}`);
    try {
      mkdirSync(folder);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  mkdirSync(path.join(folder, 'Receipts'));
  mkdirSync(path.join(folder, 'Tax documents'));
  mkdirSync(path.join(folder, 'Invoices'));

  // Files first, so the spreadsheet only names files that are really there.
  const receiptFiles = new Map<number, string>();
  for (const e of expenses) {
    if (!e.receipt) continue;
    const src = path.join(paths.files, e.receipt.replace(/^\/files\//, ''));
    if (!existsSync(src)) continue;
    const name = receiptName(e, path.extname(src));
    copyFileSync(src, path.join(folder, 'Receipts', name));
    receiptFiles.set(e.id, `Receipts/${name}`);
  }
  // The invoices and remittances income was logged from.
  const incomeFiles = new Map<number, string>();
  for (const i of income) {
    if (!i.source) continue;
    const src = path.join(paths.files, i.source.replace(/^\/files\//, ''));
    if (!existsSync(src)) continue;
    const name = `${i.paidDate ?? i.invoiceDate} ${fileSafe(i.payer)} (#${i.id})${path.extname(src)}`;
    copyFileSync(src, path.join(folder, 'Invoices', name));
    incomeFiles.set(i.id, `Invoices/${name}`);
  }
  const docFiles = new Map<number, string>();
  for (const d of docs) {
    if (!existsSync(d.path)) continue;
    const name = `${d.country} ${d.taxYear} ${fileSafe(d.title)} (#${d.id})${path.extname(d.path)}`;
    copyFileSync(d.path, path.join(folder, 'Tax documents', name));
    docFiles.set(d.id, `Tax documents/${name}`);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mission Control';
  wb.created = now;
  const sheet = (name: string, columns: { header: string; key: string; width: number; money?: boolean }[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: MONEY } : {} }));
    ws.getRow(1).font = { bold: true };
    return ws;
  };

  const received = income.filter((i) => i.paidDate);
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
  const audExpenses = expenses.filter((e) => e.currency === 'AUD');
  const usdExpenses = expenses.filter((e) => e.currency === 'USD');
  const summary = sheet('Summary', [
    { header: `Tax year ${fy} (1 July ${from.slice(0, 4)} to 30 June ${to.slice(0, 4)})`, key: 'label', width: 46 },
    { header: 'Amount', key: 'value', width: 16, money: true },
    { header: '', key: 'note', width: 60 },
  ]);
  summary.addRows([
    { label: 'Income received (AUD)', value: dollars(sum(received.map((i) => i.receivedAud))), note: `${received.length} payments; the Australian dollars that arrived` },
    { label: 'US tax withheld (USD)', value: dollars(sum(received.filter((i) => i.currency === 'USD').map((i) => i.withheld))), note: 'May be claimable as a foreign income tax offset. Check with the accountant.' },
    { label: 'Invoiced, not yet paid', value: null, note: income.filter((i) => !i.paidDate).map((i) => `${i.payer} ${i.currency} ${(i.amount / 100).toFixed(2)}`).join('; ') || 'None' },
    { label: 'Expenses (AUD)', value: dollars(sum(audExpenses.map((e) => e.amount))), note: `${audExpenses.length} expenses` },
    { label: 'GST in those expenses', value: dollars(sum(audExpenses.map((e) => e.gst))), note: 'Only where the receipt showed it' },
    ...(usdExpenses.length ? [{ label: 'Expenses (USD)', value: dollars(sum(usdExpenses.map((e) => e.amount))), note: `${usdExpenses.length} expenses paid in US dollars` }] : []),
    {},
    { label: 'Expenses by category (AUD)' },
    ...[...new Set(audExpenses.map((e) => e.category))].sort().map((c) => ({ label: `  ${c}`, value: dollars(sum(audExpenses.filter((e) => e.category === c).map((e) => e.amount))) })),
  ]);

  const inc = sheet('Income', [
    { header: 'Paid', key: 'paid', width: 12 },
    { header: 'Invoiced', key: 'invoiced', width: 12 },
    { header: 'Due', key: 'due', width: 12 },
    { header: 'Payer', key: 'payer', width: 28 },
    { header: 'For', key: 'for', width: 36 },
    { header: 'Invoice no.', key: 'number', width: 14 },
    { header: 'Country', key: 'country', width: 9 },
    { header: 'Currency', key: 'currency', width: 9 },
    { header: 'Amount', key: 'amount', width: 14, money: true },
    { header: 'US tax withheld', key: 'withheld', width: 15, money: true },
    { header: 'AUD received', key: 'aud', width: 14, money: true },
    { header: 'US tax year', key: 'us', width: 11 },
    { header: 'Invoice or remittance', key: 'file', width: 44 },
    { header: 'Notes', key: 'notes', width: 40 },
  ]);
  for (const i of income) {
    inc.addRow({
      paid: i.paidDate ?? 'Not yet',
      invoiced: i.invoiceDate,
      due: i.dueDate,
      payer: i.payer,
      for: [i.description, i.cardId ? cards.get(i.cardId) : null].filter(Boolean).join(', '),
      number: i.invoiceNumber,
      country: i.country,
      currency: i.currency,
      amount: dollars(i.amount),
      withheld: dollars(i.withheld),
      aud: dollars(i.receivedAud),
      us: i.usTaxYear,
      file: incomeFiles.get(i.id) ?? '',
      notes: i.notes,
    });
  }

  const exp = sheet('Expenses', [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Supplier', key: 'supplier', width: 28 },
    { header: 'What', key: 'what', width: 32 },
    { header: 'Category', key: 'category', width: 26 },
    { header: 'Currency', key: 'currency', width: 9 },
    { header: 'Amount', key: 'amount', width: 13, money: true },
    { header: 'GST', key: 'gst', width: 11, money: true },
    { header: 'Receipt', key: 'receipt', width: 56 },
    { header: 'Notes', key: 'notes', width: 40 },
  ]);
  for (const e of expenses) {
    exp.addRow({ date: e.date, supplier: e.supplier, what: e.description, category: e.category, currency: e.currency, amount: dollars(e.amount), gst: dollars(e.gst), receipt: receiptFiles.get(e.id) ?? 'No receipt', notes: e.notes });
  }

  const vault = sheet('Tax documents', [
    { header: 'Country', key: 'country', width: 9 },
    { header: 'Tax year', key: 'year', width: 10 },
    { header: 'Type', key: 'type', width: 22 },
    { header: 'Title', key: 'title', width: 36 },
    { header: 'From', key: 'issuer', width: 24 },
    { header: 'Expires', key: 'expires', width: 12 },
    { header: 'File', key: 'file', width: 60 },
  ]);
  for (const d of docs) vault.addRow({ country: d.country, year: d.taxYear, type: d.type, title: d.title, issuer: d.issuer, expires: d.expires, file: docFiles.get(d.id) ?? 'Missing' });

  await wb.xlsx.writeFile(path.join(folder, `Mission Control tax ${fy}.xlsx`));

  // The zip holds the same folder, for a one-file upload.
  const files: Record<string, Uint8Array> = {};
  const add = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) add(abs, `${prefix}${name}/`);
      else files[`${prefix}${name}`] = new Uint8Array(readFileSync(abs));
    }
  };
  const top = path.basename(folder);
  add(folder, `${top}/`);
  const zip = `${folder}.zip`;
  writeFileSync(zip, zipSync(files, { level: 6 }));

  return { folder, zip, counts: { income: income.length, expenses: expenses.length, receipts: receiptFiles.size, documents: docFiles.size } };
}
