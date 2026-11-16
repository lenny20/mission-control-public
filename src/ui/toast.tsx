import { useSyncExternalStore } from 'react';
import { IconCheck } from './icons.tsx';

type Toast = { id: number; text: string; kind: 'ok' | 'error'; action?: { label: string; run: () => void } };
let toasts: Toast[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

function dismiss(id: number) {
  toasts = toasts.filter((x) => x.id !== id);
  emit();
}

export function toast(text: string, kind: Toast['kind'] = 'ok', action?: Toast['action']) {
  const t = { id: ++seq, text, kind, action };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => dismiss(t.id), kind === 'error' ? 6000 : action ? 7000 : 2600);
}

export function Toasts() {
  const list = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
          {t.kind === 'ok' ? <IconCheck /> : null}
          {t.text}
          {t.action ? (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
