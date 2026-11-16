import type { MoneySnapshot } from '../../shared/money/types.ts';
import { createSnapshot } from '../lib/snapshot.ts';

export const moneyStore = createSnapshot<MoneySnapshot>('/api/money');
export const useMoney = () => moneyStore.use();
export const moneyMutate = moneyStore.mutate;
