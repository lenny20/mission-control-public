// The app's own "are you sure?" for deletes and other things that can't be
// taken back, in place of the browser's pop-up. It sits above any sheet or
// peek, starts on Cancel, and Escape means no.

import { useEffect, useId, useRef, useSyncExternalStore } from 'react';

type Ask = { title: string; body?: string; confirm: string; resolve: (ok: boolean) => void };

let current: Ask | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

/** Ask before doing something that can't be undone. Resolves true to go ahead. */
export function confirmAction({ title, body, confirm = 'Delete' }: { title: string; body?: string; confirm?: string }): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => {
    current = { title, body, confirm, resolve };
    emit();
  });
}

function answer(ok: boolean) {
  const ask = current;
  current = null;
  emit();
  ask?.resolve(ok);
}

export function ConfirmHost() {
  const ask = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => current,
  );
  return ask ? <ConfirmDialog key={ask.title} ask={ask} /> : null;
}

function ConfirmDialog({ ask }: { ask: Ask }) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    // While it's open, keys belong to it: Escape answers no, and nothing behind it hears shortcuts.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        answer(false);
      }
      if (e.key !== 'Tab') e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      before?.focus?.();
    };
  }, []);

  return (
    <>
      <div className="confirm-backdrop" onClick={() => answer(false)} />
      <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={ask.body ? `${id}-b` : undefined}>
        <h2 id={`${id}-t`}>{ask.title}</h2>
        {ask.body ? <p id={`${id}-b`}>{ask.body}</p> : null}
        <div className="confirm-actions">
          <button ref={cancel} className="btn" onClick={() => answer(false)}>
            Cancel
          </button>
          <button className="btn btn-destructive" onClick={() => answer(true)}>
            {ask.confirm}
          </button>
        </div>
      </div>
    </>
  );
}

/** Ask, then run `action` only if the answer is yes. */
export function ifConfirmed(ask: Parameters<typeof confirmAction>[0], action: () => unknown): void {
  void confirmAction(ask).then((ok) => {
    if (ok) void action();
  });
}
