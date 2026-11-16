// A whole-area snapshot from one GET endpoint (the Work boards, Money, ...),
// shared by every screen that shows it. Like the health store, it refetches
// after the dashboard's own writes and when the server reports that the
// logging command changed something.

import { useSyncExternalStore } from 'react';
import { api } from './api.ts';
import { onServerChange } from './store.ts';

type State<T> = { data: T | null; error: string | null };

export function createSnapshot<T extends { today: string }>(url: string) {
  let state: State<T> = { data: null, error: null };
  let inflight: Promise<void> | null = null;
  let started = false;
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((s) => s());

  function refresh(): Promise<void> {
    inflight ??= api
      .get<T>(url)
      .then((data) => {
        state = { data, error: null };
      })
      .catch((err: Error) => {
        state = { ...state, error: err.message };
      })
      .finally(() => {
        inflight = null;
        emit();
      });
    return inflight;
  }

  onServerChange(() => {
    if (started) void refresh();
  });
  // The date changes at midnight even if nothing else does.
  setInterval(() => {
    const d = new Date();
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (state.data && state.data.today !== local) void refresh();
  }, 60_000);

  return {
    use(): State<T> {
      return useSyncExternalStore(
        (cb) => {
          subs.add(cb);
          if (!started) {
            started = true;
            void refresh();
          }
          return () => subs.delete(cb);
        },
        () => state,
      );
    },
    /** Show a change before the server confirms it (a dragged card); the next refresh corrects it. */
    preview(data: T) {
      state = { ...state, data };
      emit();
    },
    get: () => state.data,
    refresh,
    /** Run a write, then refetch. A refetch already in flight began before the write, so another follows it. */
    async mutate<R>(fn: () => Promise<R>): Promise<R> {
      try {
        return await fn();
      } finally {
        if (inflight) await inflight;
        await refresh();
      }
    },
  };
}
