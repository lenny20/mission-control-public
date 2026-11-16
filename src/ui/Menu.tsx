import { useEffect, useRef, useState } from 'react';
import { IconCheck } from './icons.tsx';

/**
 * A small pop-up menu under a button. Escape or a click outside closes it,
 * and focus goes back to the button.
 */
export function Menu({ label, trigger, align = 'start', children }: { label: string; trigger: React.ReactNode; align?: 'start' | 'end'; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The menu closes; nothing behind it (a peek, a sheet) should.
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', key, true);
    wrap.current?.querySelector<HTMLElement>('.menu [role^="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('.menu [role^="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button ref={button} type="button" className="btn btn-sm menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {trigger}
      </button>
      {open ? (
        <div className={`menu menu-${align}`} role="menu" aria-label={label} onKeyDown={move}>
          {children(() => {
            setOpen(false);
            button.current?.focus();
          })}
        </div>
      ) : null}
    </div>
  );
}

/** A choice in a menu, ticked when it's the current one. An action (no `checked`) has no tick column unless `inset` lines it up with ones that do. */
export function MenuItem({ checked, inset, onSelect, children }: { checked?: boolean; inset?: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role={checked == null ? 'menuitem' : 'menuitemradio'} aria-checked={checked} className="menu-item" onClick={onSelect}>
      {checked != null || inset ? <span className="menu-tick">{checked ? <IconCheck /> : null}</span> : null}
      {children}
    </button>
  );
}

/** An on/off setting in a menu, drawn as a switch. The menu stays open. */
export function MenuToggle({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={on} className="menu-item menu-toggle" onClick={() => onChange(!on)}>
      <span className="menu-label">{children}</span>
      <span className="menu-switch" aria-hidden="true" />
    </button>
  );
}

export const MenuHeading = ({ children }: { children: React.ReactNode }) => <div className="menu-heading">{children}</div>;
