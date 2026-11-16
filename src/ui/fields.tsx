// Form fields that keep their own text while typing, and hand back numbers.

export function NumberField({
  label,
  value,
  onChange,
  unit,
  step = 'any',
  hint,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  step?: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="unit-input">
        <input type="number" inputMode="decimal" step={step} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} />
        {unit ? <em>{unit}</em> : null}
      </div>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function DateField({ label = 'Date', value, onChange, max }: { label?: string; value: string; onChange: (v: string) => void; max?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="date" value={value} max={max} onChange={(e) => onChange(e.target.value)} required />
    </label>
  );
}

export function TextField({ label, value, onChange, multiline, placeholder }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

/** '' → null, '12.5' → 12.5. Bad input → NaN, which the server rejects with a message. */
export const toNum = (s: string): number | null => (s.trim() === '' ? null : Number(s));
export const fromNum = (n: number | null | undefined): string => (n == null ? '' : String(n));

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
