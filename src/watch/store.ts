import type { WatchSnapshot } from '../../shared/watch/types.ts';
import { createSnapshot } from '../lib/snapshot.ts';
import { workStore } from '../work/store.ts';

export const watchStore = createSnapshot<WatchSnapshot>('/api/watch');
export const useWatch = () => watchStore.use();

/** Comparison titles show on Film & TV cards, so the boards refetch too. */
export async function watchMutate<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await watchStore.mutate(fn);
  } finally {
    void workStore.refresh();
  }
}
