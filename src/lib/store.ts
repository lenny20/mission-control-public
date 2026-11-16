// The health snapshot, shared by every screen. It refreshes after the
// dashboard's own edits and whenever the server says the logging command
// changed something, so a screenshot sent to Claude shows up without a reload.

import { useSyncExternalStore } from 'react';
import type { HealthSnapshot } from '../../shared/health/types.ts';
import { api } from './api.ts';

type State = { data: HealthSnapshot | null; error: string | null; changedAt: number };

let state: State = { data: null, error: null, changedAt: 0 };
const subscribers = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const s of subscribers) s();
}

let inflight: Promise<void> | null = null;
export function refresh(): Promise<void> {
  inflight ??= api
    .get<HealthSnapshot>('/api/health')
    .then((data) => set({ data, error: null, changedAt: Date.now() }))
    .catch((err: Error) => set({ error: err.message }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Other stores (the calendar) refresh on the same signal. */
const changeListeners = new Set<() => void>();
export function onServerChange(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

let events: EventSource | null = null;
function connect() {
  if (events) return;
  events = new EventSource('/api/events');
  const changed = () => {
    void refresh();
    changeListeners.forEach((fn) => fn());
  };
  events.addEventListener('changed', changed);
  // Coming back from sleep or a dropped connection: catch up on anything missed.
  events.addEventListener('open', changed);
}

export function useHealth(): State {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      if (!state.data && !inflight) void refresh();
      connect();
      return () => subscribers.delete(cb);
    },
    () => state,
  );
}

/**
 * Run a write, then refresh everything. A refresh already in flight started
 * before the write, so it's allowed to finish and a new one follows it.
 * Throws the server's message on failure.
 */
export async function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const out = await fn();
  if (inflight) await inflight;
  await refresh();
  return out;
}

// The date changes at midnight even if nothing else does.
setInterval(() => {
  if (state.data && state.data.today !== localToday()) void refresh();
}, 60_000);

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
