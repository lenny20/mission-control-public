import type { Profile } from '../shared/profile.ts';
import { createSnapshot } from './lib/snapshot.ts';

export const profileStore = createSnapshot<{ today: string; profile: Profile; connections: Record<string, boolean> }>('/api/profile');
export const useProfile = profileStore.use;
