import { useEffect, useId, useRef } from 'react';
import { useKey } from '../lib/hooks.ts';
import { IconClose } from './icons.tsx';

/**
 * The edit dialog: centred on a desk, a sheet from the bottom on a phone.
 * Escape or the backdrop closes it.
 * Focus moves into the sheet when it opens and back where it was when it closes.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  useKey('Escape', onClose);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.sheet-close)');
    (first ?? panel.current)?.focus();
    return () => before?.focus?.();
  }, []);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={id} ref={panel} tabIndex={-1}>
        <div className="sheet-head">
          <div>
            <h2 id={id}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="btn btn-quiet icon-btn sheet-close" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </>
  );
}
