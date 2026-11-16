// The Money drawers: income, expenses and tax documents.

import { useState } from 'react';
import { EXPENSE_CATEGORIES, VAULT_TYPES } from '../../../shared/money/schemas.ts';
import { auTaxYear, usTaxYear } from '../../../shared/money/tax.ts';
import type { Expense, Income, MoneySnapshot, VaultDoc } from '../../../shared/money/types.ts';
import { api } from '../../lib/api.ts';
import { fromCents, toDollars } from '../../money/derive.ts';
import { moneyMutate } from '../../money/store.ts';
import { Segmented } from '../../ui/fields.tsx';
import { IconExternal } from '../../ui/icons.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/toast.tsx';
import { ifConfirmed } from '../../ui/confirm.tsx';
import { useWork } from '../../work/store.ts';

type Close = { onClose: () => void };

function Foot({ busy, label, onDelete, onClose, form }: { busy: boolean; label: string; onDelete?: () => void; onClose: () => void; form: string }) {
  return (
    <>
      {onDelete ? (
        <button className="btn btn-danger" type="button" onClick={onDelete} disabled={busy}>
          Delete
        </button>
      ) : null}
      <span className="spacer" />
      <button className="btn btn-quiet" type="button" onClick={onClose}>
        Cancel
      </button>
      <button className="btn btn-primary" type="submit" form={form} disabled={busy}>
        {label}
      </button>
    </>
  );
}

/** Run a save; on success close, on failure show the server's reason in the drawer. */
function useSave(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await moneyMutate(fn);
      toast(done);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

const Money = ({ label, value, onChange, currency, hint }: { label: string; value: string; onChange: (v: string) => void; currency: string; hint?: string }) => (
  <label className="field">
    <span>{label}</span>
    <div className="unit-input">
      <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" />
      <em>{currency}</em>
    </div>
    {hint ? <small>{hint}</small> : null}
  </label>
);

// ------------------------------------------------------------------ income

export function IncomeSheet({ data, income, onClose }: { data: MoneySnapshot; income?: Income } & Close) {
  const films = (useWork().data?.cards ?? []).filter((c) => c.board === 'film');
  const [f, setF] = useState({
    payer: income?.payer ?? '',
    description: income?.description ?? '',
    cardId: income?.cardId ? String(income.cardId) : '',
    country: income?.country ?? 'AU',
    currency: income?.currency ?? 'AUD',
    amount: fromCents(income?.amount),
    invoiceNumber: income?.invoiceNumber ?? '',
    invoiceDate: income?.invoiceDate ?? data.today,
    dueDate: income?.dueDate ?? '',
    paidDate: income?.paidDate ?? '',
    receivedAud: fromCents(income?.receivedAudGiven),
    withheld: fromCents(income?.withheld),
    notes: income?.notes ?? '',
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const { busy, error, run } = useSave(onClose);
  const body = () => ({
    payer: f.payer,
    description: f.description || null,
    cardId: f.cardId ? Number(f.cardId) : null,
    country: f.country,
    currency: f.currency,
    amount: toDollars(f.amount),
    invoiceNumber: f.invoiceNumber || null,
    invoiceDate: f.invoiceDate,
    dueDate: f.dueDate || null,
    paidDate: f.paidDate || null,
    receivedAud: f.paidDate ? toDollars(f.receivedAud) : null,
    withheld: f.paidDate ? toDollars(f.withheld) : null,
    notes: f.notes || null,
  });
  const counted = f.paidDate || f.invoiceDate;
  return (
    <Sheet
      title={income ? 'Edit income' : 'Money owed to you'}
      subtitle={counted ? `Counts in tax year ${auTaxYear(counted)}${f.country === 'US' ? ` (US ${usTaxYear(counted)})` : ''}, by the ${f.paidDate ? 'paid' : 'invoice'} date.` : undefined}
      onClose={onClose}
      footer={
        <Foot
          busy={busy}
          label={income ? 'Save' : 'Add'}
          form="income-form"
          onClose={onClose}
          onDelete={income ? () => ifConfirmed({ title: `Delete the ${income.payer} entry?` }, () => run(() => api.del(`/api/money/income/${income.id}`), 'Deleted')) : undefined}
        />
      }
    >
      <form
        id="income-form"
        className="card-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => (income ? api.put(`/api/money/income/${income.id}`, body()) : api.post('/api/money/income', body())), income ? 'Saved' : 'Added');
        }}
      >
        <div className="field-row">
          <label className="field">
            <span>Payer</span>
            <input value={f.payer} onChange={(e) => set({ payer: e.target.value })} required autoFocus={!income} />
          </label>
          <label className="field">
            <span>Invoice number</span>
            <input value={f.invoiceNumber} onChange={(e) => set({ invoiceNumber: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span>What it's for</span>
          <input value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Script fee, draft 2" />
        </label>
        {films.length ? (
          <label className="field">
            <span>Film & TV project</span>
            <select value={f.cardId} onChange={(e) => set({ cardId: e.target.value })}>
              <option value="">None</option>
              {films.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="field-row">
          <div className="field">
            <span>Country</span>
            <Segmented label="Country" value={f.country} onChange={(country) => set({ country, currency: country === 'US' ? 'USD' : f.currency })} options={[{ value: 'AU', label: 'Australia' }, { value: 'US', label: 'US' }]} />
          </div>
          <div className="field">
            <span>Currency</span>
            <Segmented label="Currency" value={f.currency} onChange={(currency) => set({ currency })} options={[{ value: 'AUD', label: 'AUD' }, { value: 'USD', label: 'USD' }]} />
          </div>
        </div>
        <div className="field-row">
          <Money label="Amount" value={f.amount} onChange={(amount) => set({ amount })} currency={f.currency} />
          <label className="field">
            <span>Invoice date</span>
            <input type="date" value={f.invoiceDate} onChange={(e) => set({ invoiceDate: e.target.value })} required />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Due</span>
            <input type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
          </label>
          <label className="field">
            <span>Paid</span>
            <input type="date" value={f.paidDate} onChange={(e) => set({ paidDate: e.target.value })} />
          </label>
        </div>
        {income?.source ? (
          <a className="link-btn small" href={income.source} target="_blank" rel="noreferrer">
            View the invoice or remittance it came from <IconExternal />
          </a>
        ) : null}
        {f.paidDate ? (
          <div className="field-row">
            {f.currency === 'USD' || f.country === 'US' ? <Money label="US tax withheld" value={f.withheld} onChange={(withheld) => set({ withheld })} currency={f.currency} /> : null}
            <Money label="AUD received" value={f.receivedAud} onChange={(receivedAud) => set({ receivedAud })} currency="AUD" hint={f.currency === 'AUD' ? 'Left blank: the amount less any tax withheld.' : 'What actually arrived in your account.'} />
          </div>
        ) : null}
        <label className="field">
          <span>Notes</span>
          <textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Sheet>
  );
}

// ------------------------------------------------------------------ expenses

export function ExpenseSheet({ data, expense, onClose }: { data: MoneySnapshot; expense?: Expense } & Close) {
  const [f, setF] = useState({
    date: expense?.date ?? data.today,
    supplier: expense?.supplier ?? '',
    description: expense?.description ?? '',
    currency: expense?.currency ?? 'AUD',
    amount: fromCents(expense?.amount),
    gst: fromCents(expense?.gst),
    category: expense?.category ?? '',
    notes: expense?.notes ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const { busy, error, run } = useSave(onClose);
  const categories = [...new Set([...EXPENSE_CATEGORIES, ...data.expenses.map((e) => e.category)])];
  const save = (allowDuplicate = false) => {
    const form = new FormData();
    form.set(
      'data',
      JSON.stringify({
        date: f.date,
        supplier: f.supplier,
        description: f.description || null,
        currency: f.currency,
        amount: toDollars(f.amount),
        gst: f.currency === 'AUD' ? toDollars(f.gst) : null,
        category: f.category || 'Other',
        notes: f.notes || null,
      }),
    );
    if (file) form.set('receipt', file);
    if (allowDuplicate) form.set('allowDuplicate', '1');
    return run(() => (expense ? api.put(`/api/money/expenses/${expense.id}`, form) : api.post('/api/money/expenses', form)), expense ? 'Saved' : 'Expense added');
  };
  return (
    <Sheet
      title={expense ? 'Edit expense' : 'New expense'}
      subtitle={f.date ? `Tax year ${auTaxYear(f.date)}` : undefined}
      onClose={onClose}
      footer={
        <Foot
          busy={busy}
          label={expense ? 'Save' : 'Add'}
          form="expense-form"
          onClose={onClose}
          onDelete={expense ? () => ifConfirmed({ title: `Delete the ${expense.supplier} expense?`, body: 'Its receipt goes too.' }, () => run(() => api.del(`/api/money/expenses/${expense.id}`), 'Deleted')) : undefined}
        />
      }
    >
      <form
        id="expense-form"
        className="card-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field-row">
          <label className="field">
            <span>Supplier</span>
            <input value={f.supplier} onChange={(e) => set({ supplier: e.target.value })} required autoFocus={!expense} />
          </label>
          <label className="field">
            <span>Date</span>
            <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} required />
          </label>
        </div>
        <label className="field">
          <span>What</span>
          <input value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Annual subscription" />
        </label>
        <div className="field">
          <span>Currency</span>
          <Segmented label="Currency" value={f.currency} onChange={(currency) => set({ currency })} options={[{ value: 'AUD', label: 'AUD' }, { value: 'USD', label: 'USD' }]} />
        </div>
        <div className="field-row">
          <Money label="Amount" value={f.amount} onChange={(amount) => set({ amount })} currency={f.currency} hint="The total paid, GST included." />
          {f.currency === 'AUD' ? <Money label="GST" value={f.gst} onChange={(gst) => set({ gst })} currency="AUD" hint="Only if the receipt shows it." /> : null}
        </div>
        <label className="field">
          <span>Category</span>
          <input list="expense-categories" value={f.category} onChange={(e) => set({ category: e.target.value })} placeholder="Other" />
          <datalist id="expense-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Receipt</span>
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {expense?.receipt && !file ? (
            <a className="link-btn small" href={expense.receipt} target="_blank" rel="noreferrer">
              View the receipt <IconExternal />
            </a>
          ) : null}
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        {error ? (
          <p className="form-error">
            {error}{' '}
            {/again/.test(error) ? (
              <button className="link-btn" type="button" onClick={() => void save(true)}>
                Add it anyway
              </button>
            ) : null}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

// ------------------------------------------------------------------ vault

export function VaultSheet({ data, doc, onClose }: { data: MoneySnapshot; doc?: VaultDoc } & Close) {
  const [f, setF] = useState({
    title: doc?.title ?? '',
    country: doc?.country ?? 'AU',
    taxYear: doc?.taxYear ?? auTaxYear(data.today),
    type: doc?.type ?? '',
    issuer: doc?.issuer ?? '',
    expires: doc?.expires ?? '',
    notes: doc?.notes ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const { busy, error, run } = useSave(onClose);
  const body = { title: f.title, country: f.country, taxYear: f.taxYear, type: f.type || 'Other', issuer: f.issuer || null, expires: f.expires || null, notes: f.notes || null };
  return (
    <Sheet
      title={doc ? 'Tax document' : 'Add to the tax vault'}
      subtitle={doc ? `${doc.country} ${doc.taxYear}` : 'Documents from the accountant, the ATO and the IRS, and US forms.'}
      onClose={onClose}
      footer={
        <Foot
          busy={busy}
          label={doc ? 'Save' : 'Add'}
          form="vault-form"
          onClose={onClose}
          onDelete={doc ? () => ifConfirmed({ title: `Remove “${doc.title}” from the vault?`, body: "The file moves to the vault's .trash folder.", confirm: 'Remove' }, () => run(() => api.del(`/api/money/vault/${doc.id}`), 'Removed')) : undefined}
        />
      }
    >
      <form
        id="vault-form"
        className="card-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (doc) return void run(() => api.put(`/api/money/vault/${doc.id}`, body), 'Saved');
          const form = new FormData();
          form.set('data', JSON.stringify(body));
          if (file) form.set('file', file);
          void run(() => api.post('/api/money/vault', form), 'Filed in the vault');
        }}
      >
        {doc ? (
          <a className="btn" href={doc.file} target="_blank" rel="noreferrer">
            Open the document <IconExternal />
          </a>
        ) : (
          <label className="field">
            <span>Document</span>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </label>
        )}
        <label className="field">
          <span>Title</span>
          <input value={f.title} onChange={(e) => set({ title: e.target.value })} required placeholder="Notice of assessment" />
        </label>
        <div className="field-row">
          <div className="field">
            <span>Country</span>
            <Segmented
              label="Country"
              value={f.country}
              onChange={(country) => set({ country, taxYear: country === 'US' ? usTaxYear(data.today) : auTaxYear(data.today) })}
              options={[{ value: 'AU', label: 'Australia' }, { value: 'US', label: 'US' }]}
            />
          </div>
          <label className="field">
            <span>Tax year</span>
            <input value={f.taxYear} onChange={(e) => set({ taxYear: e.target.value })} placeholder={f.country === 'AU' ? '2025-26' : '2025'} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Type</span>
            <input list="vault-types" value={f.type} onChange={(e) => set({ type: e.target.value })} placeholder="Other" />
            <datalist id="vault-types">
              {VAULT_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>From</span>
            <input value={f.issuer} onChange={(e) => set({ issuer: e.target.value })} placeholder="ATO, IRS, the accountant" />
          </label>
        </div>
        <label className="field">
          <span>Expires</span>
          <input type="date" value={f.expires} onChange={(e) => set({ expires: e.target.value })} />
          <small>For forms that lapse, like a W-8BEN. Today warns two months ahead.</small>
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Sheet>
  );
}
