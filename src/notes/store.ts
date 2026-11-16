import type { NotesSnapshot } from '../../shared/docs/types.ts';
import { createSnapshot } from '../lib/snapshot.ts';
import { workStore } from '../work/store.ts';

export const notesStore = createSnapshot<NotesSnapshot>('/api/notes');
export const useNotes = () => notesStore.use();

/** Run a write, then refetch. Sorting an idea can make a card, so the boards refetch too. */
export async function notesMutate<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await notesStore.mutate(fn);
  } finally {
    void workStore.refresh();
  }
}
