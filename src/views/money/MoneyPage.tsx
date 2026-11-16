// Money & tax: what's owed and received, expenses with receipts, the tax
// vault, and the export for the accountant. Tax years are Australian
// (July to June) unless a US one is named.

import { useEffect, useState } from 'react';
import { daysBetween, formatDayMonthYear, formatShort } from '../../../shared/dates.ts';
import { auTaxYear, money, taxYearRange } from '../../../shared/money/tax.ts';
import type { MoneySnapshot } from '../../../shared/money/types.ts';
import { api } from '../../lib/api.ts';
import { href, navigate, MONEY_TABS, type MoneyTab } from '../../lib/router.ts';
import { useRequest } from '../../lib/commands.ts';
import { useKey } from '../../lib/hooks.ts';
import { expiring, overdue, taxYears } from '../../money/derive.ts';
import { useMoney } from '../../money/store.ts';
import { IconCheck, IconFolder, IconMoney, IconNotes, IconPlus } from '../../ui/icons.tsx';
import { toast } from '../../ui/toast.tsx';
import { plural } from '../../lib/format.ts';
import { ExpenseSheet, IncomeSheet, VaultSheet } from './MoneySheets.tsx';
import { MONEY_IN, MONEY_OUT, MoneyChart, monthsOf } from '../../charts/MoneyChart.tsx';

const LABELS: Record<MoneyTab, string> = { overview: 'Overview', income: 'Income', expenses: 'Expenses', vault: 'Tax vault' };
type Draft = 'income' | 'expense' | 'vault' | null;

export function MoneyPage({ tab, id }: { tab: MoneyTab; id?: number }) {
  const { data, error } = useMoney();
  const [draft, setDraft] = useState<Draft>(null);
  const [fy, setFy] = useState<string | null>(null);
  const year = fy ?? (data ? auTaxYear(data.today) : '');

  useKey('n', (e) => {
    if (document.querySelector('.sheet')) return;
    e.preventDefault();
    setDraft(tab === 'expenses' ? 'expense' : tab === 'vault' ? 'vault' : 'income');
  });
  // "Add income", "Add an expense" and "Add a tax document" from the command palette.
  useRequest('money', setDraft);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.sheet')) return;
      const next = MONEY_TABS[Number(e.key) - 1];
      if (next) navigate({ area: 'money', tab: next });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const close = () => (id ? navigate({ area: 'money', tab }) : setDraft(null));
  const income = data && id && tab === 'income' ? data.income.find((x) => x.id === id) : undefined;
  const expense = data && id && tab === 'expenses' ? data.expenses.find((x) => x.id === id) : undefined;
  const doc = data && id && tab === 'vault' ? data.vault.find((x) => x.id === id) : undefined;

  return (
    <div className="page money-page">
      <header className="page-head">
        <h1 className="page-title">Money</h1>
        <nav className="tabs" aria-label="Money sections">
          {MONEY_TABS.map((t, i) => (
            <a key={t} className="tab" href={href({ area: 'money', tab: t })} aria-current={t === tab ? 'page' : undefined} title={`Press ${i + 1}`}>
              {LABELS[t]}
            </a>
          ))}
        </nav>
        <div className="head-actions">
          {data && tab !== 'vault' ? (
            <select className="input fy-pick" value={year} onChange={(e) => setFy(e.target.value)} aria-label="Tax year">
              {taxYears(data).map((y) => (
                <option key={y} value={y}>
                  Tax year {y}
                </option>
              ))}
            </select>
          ) : null}
          <button className="btn" onClick={() => setDraft('income')}>
            <IconPlus /> Income
          </button>
          <button className="btn" onClick={() => setDraft('expense')}>
            <IconPlus /> Expense
          </button>
          <button className="btn" onClick={() => setDraft('vault')}>
            <IconPlus /> Document
          </button>
        </div>
      </header>
      {error && !data ? (
        <div className="empty">
          <strong>Money couldn't load.</strong>
          {error}
        </div>
      ) : !data ? (
        <div className="loading" aria-busy="true" />
      ) : tab === 'overview' ? (
        <Overview data={data} fy={year} />
      ) : tab === 'income' ? (
        <IncomeList data={data} fy={year} onAdd={() => setDraft('income')} />
      ) : tab === 'expenses' ? (
        <ExpenseList data={data} fy={year} onAdd={() => setDraft('expense')} />
      ) : (
        <VaultList data={data} onAdd={() => setDraft('vault')} />
      )}
      {data && (draft === 'income' || income) ? <IncomeSheet key={income?.id ?? 'new'} data={data} income={income} onClose={close} /> : null}
      {data && (draft === 'expense' || expense) ? <ExpenseSheet key={expense?.id ?? 'new'} data={data} expense={expense} onClose={close} /> : null}
      {data && (draft === 'vault' || doc) ? <VaultSheet key={doc?.id ?? 'new'} data={data} doc={doc} onClose={close} /> : null}
    </div>
  );
}

const open = (tab: MoneyTab, id: number) => navigate({ area: 'money', tab, id });
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

// ------------------------------------------------------------------ overview

function Overview({ data, fy }: { data: MoneySnapshot; fy: string }) {
  const [from, to] = taxYearRange('AU', fy);
  const income = data.income.filter((i) => i.auTaxYear === fy);
  const received = income.filter((i) => i.paidDate);
  const owed = data.income.filter((i) => !i.paidDate);
  const expenses = data.expenses.filter((e) => e.date >= from && e.date <= to);
  const aud = expenses.filter((e) => e.currency === 'AUD');
  const late = overdue(data);
  const soon = expiring(data);
  const [exporting, setExporting] = useState(false);
  const owedBy = (cur: 'AUD' | 'USD') => sum(owed.filter((i) => i.currency === cur).map((i) => i.amount));

  const runExport = async () => {
    setExporting(true);
    try {
      const r = await api.post<{ folder: string; counts: { income: number; expenses: number; receipts: number; documents: number } }>(`/api/money/export?fy=${fy}`);
      toast(`Exported ${r.counts.expenses} expenses, ${r.counts.receipts} receipts and ${r.counts.documents} documents to ${r.folder.replace(/^\/home\/[^/]+/, '~')}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  };

  // Overdue first, then by when they're due; invoices with no due date last.
  const unpaid = [...owed].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const months = monthsOf(from, data.income, data.expenses);
  const thisMonth = data.today >= from && data.today <= to ? data.today.slice(0, 7) : null;

  return (
    <div className="money-overview">
      <div className="money-top">
        <section className={`owed ${unpaid.length ? '' : 'is-clear'}`} aria-labelledby="owed-title">
          <h2 id="owed-title" className="owed-label">
            Owed to you
          </h2>
          <Figure text={owedBy('AUD') || !owedBy('USD') ? money(owedBy('AUD')) : money(owedBy('USD'), 'USD')} />
          <p className="owed-sub">
            {unpaid.length ? null : <IconCheck />}
            {owedBy('AUD') && owedBy('USD') ? `Plus ${money(owedBy('USD'), 'USD')}. ` : ''}
            {owed.length ? `${plural(owed.length, 'invoice')} out${late.length ? `, ${late.length} overdue` : ''}.` : 'Nothing outstanding.'}
          </p>
          {unpaid.length ? (
            <ul className="owed-list">
              {unpaid.map((i) => {
                const days = i.dueDate ? daysBetween(data.today, i.dueDate) : null;
                return (
                  <li key={i.id}>
                    <a className={`owed-row ${days != null && days < 0 ? 'late' : ''}`} href={href({ area: 'money', tab: 'income', id: i.id })}>
                      <span className="owed-who">
                        <strong>{i.payer}</strong>
                        <span className="faint">{i.description ?? `Invoiced ${formatShort(i.invoiceDate)}`}</span>
                      </span>
                      <span className="owed-when">{days == null ? 'No due date' : days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : days === 0 ? 'Due today' : `Due ${formatShort(i.dueDate!)}`}</span>
                      <span className="owed-amount num">{money(i.amount, i.currency)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        <dl className="money-facts">
          <div style={{ '--hue': MONEY_IN } as React.CSSProperties}>
            <dt>Received in {fy}</dt>
            <dd className="num">{money(sum(received.map((i) => i.receivedAud)))}</dd>
            <dd className="faint">{plural(received.length, 'payment')}, in Australian dollars</dd>
          </div>
          <div style={{ '--hue': MONEY_OUT } as React.CSSProperties}>
            <dt>Expenses in {fy}</dt>
            <dd className="num">{money(sum(aud.map((e) => e.amount)))}</dd>
            <dd className="faint">
              GST {money(sum(aud.map((e) => e.gst)))}
              {expenses.length > aud.length ? `, plus ${money(sum(expenses.filter((e) => e.currency === 'USD').map((e) => e.amount)), 'USD')}` : ''}
            </dd>
          </div>
          <div style={{ '--hue': '#ffb340' } as React.CSSProperties}>
            <dt>US tax withheld</dt>
            <dd className="num">{money(sum(received.map((i) => (i.currency === 'USD' ? i.withheld : null))), 'USD')}</dd>
            <dd className="faint">on payments received in {fy}</dd>
          </div>
        </dl>
      </div>

      <section className={`money-year ${months.some((mo) => mo.inAud || mo.outAud) ? '' : 'is-empty'}`} aria-labelledby="year-title">
        <div className="section-head">
          <h2 id="year-title">{fy}, month by month</h2>
          <span className="legend">
            <span className="legend-item">
              <span className="dot" style={{ background: MONEY_IN }} /> Received
            </span>
            <span className="legend-item">
              <span className="dot" style={{ background: MONEY_OUT }} /> Spent
            </span>
          </span>
        </div>
        <MoneyChart months={months} current={thisMonth} />
        {months.some((mo) => mo.inAud || mo.outAud) ? null : <p className="money-year-empty">Nothing received or spent in {fy} yet. Each month fills in as money moves.</p>}
      </section>

      {soon.length ? (
        <section>
          <h2 className="block-title">Forms expiring</h2>
          <ul className="review-list">
            {soon.map((v) => (
              <li key={v.id}>
                <a href={href({ area: 'money', tab: 'vault', id: v.id })}>{v.title}</a>
                <span className="faint small">{v.expires! < data.today ? 'expired' : 'expires'} {formatDayMonthYear(v.expires!)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="export-box">
        <span className="export-icon" aria-hidden="true">
          <IconFolder />
        </span>
        <div className="export-text">
          <h2>Export {fy} for the accountant</h2>
          <p className="faint">
            A spreadsheet of income, expenses and tax documents, a folder of every receipt, and a zip of it all, saved in {data.exportDir}. Drop the zip into Google Drive.
          </p>
        </div>
        <button className="btn btn-primary" onClick={runExport} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export'}
        </button>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ lists

/**
 * The hero figure: the currency and cents set small beside the whole
 * dollars, so the amount reads at a glance.
 */
function Figure({ text }: { text: string }) {
  const m = /^(\D*)([\d,]+)(\.\d+)?$/.exec(text);
  if (!m) return <p className="owed-big">{text}</p>;
  return (
    <p className="owed-big" aria-label={text}>
      <span className="owed-cur">{m[1]}</span>
      {m[2]}
      {m[3] ? <span className="owed-cents">{m[3]}</span> : null}
    </p>
  );
}

function IncomeList({ data, fy, onAdd }: { data: MoneySnapshot; fy: string; onAdd: () => void }) {
  const rows = data.income.filter((i) => i.auTaxYear === fy || !i.paidDate);
  if (!rows.length) return <Empty what="income" fy={fy} onAdd={onAdd} />;
  return (
    <table className="table money-table">
      <thead>
        <tr>
          <th>Payer</th>
          <th>For</th>
          <th>Invoiced</th>
          <th>Due</th>
          <th>Paid</th>
          <th className="r">Amount</th>
          <th className="r">AUD received</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => {
          const late = !i.paidDate && i.dueDate && i.dueDate < data.today;
          return (
            <tr key={i.id} onClick={() => open('income', i.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open('income', i.id)} className={late ? 'late' : ''}>
              <td className="strong">{i.payer}</td>
              <td className="muted">{i.description}</td>
              <td className="num">{formatShort(i.invoiceDate)}</td>
              <td className="num">{i.dueDate ? formatShort(i.dueDate) : ''}</td>
              <td className="num">{i.paidDate ? formatShort(i.paidDate) : <span className={late ? 'bad' : 'faint'}>{late ? 'Overdue' : 'Unpaid'}</span>}</td>
              <td className="num r">
                {money(i.amount, i.currency)}
                {i.withheld ? <span className="faint small"> less {money(i.withheld, i.currency)} tax</span> : null}
              </td>
              <td className="num r">{money(i.receivedAud)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ExpenseList({ data, fy, onAdd }: { data: MoneySnapshot; fy: string; onAdd: () => void }) {
  const [from, to] = taxYearRange('AU', fy);
  const rows = data.expenses.filter((e) => e.date >= from && e.date <= to);
  if (!rows.length) return <Empty what="expenses" fy={fy} onAdd={onAdd} />;
  return (
    <table className="table money-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Supplier</th>
          <th>Category</th>
          <th className="r">Amount</th>
          <th className="r">GST</th>
          <th>Receipt</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id} onClick={() => open('expenses', e.id)} tabIndex={0} onKeyDown={(k) => k.key === 'Enter' && open('expenses', e.id)}>
            <td className="num">{formatShort(e.date)}</td>
            <td className="strong">
              {e.supplier}
              {e.description ? <span className="muted small"> {e.description}</span> : null}
            </td>
            <td className="muted">{e.category}</td>
            <td className="num r">{money(e.amount, e.currency)}</td>
            <td className="num r">{e.gst != null ? money(e.gst) : ''}</td>
            <td>{e.receipt ? <a href={e.receipt} target="_blank" rel="noreferrer" onClick={(x) => x.stopPropagation()}>View</a> : <span className="faint">None</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VaultList({ data, onAdd }: { data: MoneySnapshot; onAdd: () => void }) {
  if (!data.vault.length)
    return (
      <div className="blank">
        <span className="blank-icon" aria-hidden="true">
          <IconNotes />
        </span>
        <h3 className="blank-title">The tax vault is empty</h3>
        <p className="blank-text">File the accountant's letters, ATO and IRS notices and US forms here, or send them to Claude. They're searchable from Notes.</p>
        <button className="btn btn-primary" onClick={onAdd}>
          <IconPlus /> Add a document
        </button>
      </div>
    );
  const groups = [...new Set(data.vault.map((v) => `${v.country} ${v.taxYear}`))];
  return (
    <div className="vault">
      {groups.map((g) => (
        <section key={g}>
          <h2 className="block-title">{g.startsWith('AU') ? `Australia, ${g.slice(3)}` : `United States, ${g.slice(3)}`}</h2>
          <ul className="review-list">
            {data.vault
              .filter((v) => `${v.country} ${v.taxYear}` === g)
              .map((v) => (
                <li key={v.id}>
                  <a href={href({ area: 'money', tab: 'vault', id: v.id })}>{v.title}</a>
                  <span className="faint small">
                    {v.type}
                    {v.issuer ? `, ${v.issuer}` : ''}
                    {v.expires ? `, ${v.expires < data.today ? 'expired' : 'expires'} ${formatDayMonthYear(v.expires)}` : ''}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const Empty = ({ what, fy, onAdd }: { what: 'income' | 'expenses'; fy: string; onAdd: () => void }) => (
  <div className="blank">
    <span className="blank-icon" aria-hidden="true">
      <IconMoney />
    </span>
    <h3 className="blank-title">
      No {what} in {fy}
    </h3>
    <p className="blank-text">Add {what === 'expenses' ? 'one' : 'it'} here, or send Claude {what === 'expenses' ? 'a receipt' : 'a remittance or invoice'}.</p>
    <button className="btn btn-primary" onClick={onAdd}>
      <IconPlus /> {what === 'expenses' ? 'Add an expense' : 'Add income'}
    </button>
  </div>
);
