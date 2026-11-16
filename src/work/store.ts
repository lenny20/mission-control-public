import type { WorkSnapshot } from '../../shared/work/types.ts';
import { refreshCalendar } from '../calendar/store.ts';
import { createSnapshot } from '../lib/snapshot.ts';

export const workStore = createSnapshot<WorkSnapshot>('/api/work');
export const useWork = () => workStore.use();

/** Run a Work write, then refetch the boards and the calendar, where due dates show. */
export async function workMutate<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await workStore.mutate(fn);
  } finally {
    void refreshCalendar();
  }
}
