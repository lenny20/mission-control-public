// A small channel for asking a page to start something it owns, like a new
// card or a new expense, from outside it (the command palette). The request
// waits until the page is on screen to take it.

import { useEffect, useRef } from 'react';

/** What each area can be asked to start. */
type Whats = { work: 'film' | 'software'; money: 'income' | 'expense' | 'vault'; watch: 'add'; recipes: 'add'; docs: string };
export type Request = { [A in keyof Whats]: { area: A; what: Whats[A] } }[keyof Whats];

let pending: Request | null = null;
const subs = new Set<() => void>();

export function request(r: Request) {
  pending = r;
  subs.forEach((s) => s());
}

/** Run `fn` with a request for this area: one waiting when the page mounts, or one made while it's showing. */
export function useRequest<A extends keyof Whats>(area: A, fn: (what: Whats[A]) => void) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    const check = () => {
      if (pending?.area !== area) return;
      const what = pending.what as Whats[A];
      pending = null;
      saved.current(what);
    };
    check();
    subs.add(check);
    return () => {
      subs.delete(check);
    };
  }, [area]);
}
