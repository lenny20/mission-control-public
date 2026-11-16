// Which tax forms Today and the money summary flag.

import { addDays, type DateStr } from '../dates.ts';
import type { VaultDoc } from './types.ts';

/** Forms expiring within this many days are flagged. */
export const EXPIRY_WARNING_DAYS = 60;
/** An expired form is mentioned this long after it lapses, then left alone. */
export const EXPIRED_SHOWN_DAYS = 30;

/**
 * Forms expiring soon, or lapsed recently. One that a newer form of the same
 * type and country has replaced isn't flagged at all.
 */
export function formsToFlag(vault: VaultDoc[], today: DateStr): VaultDoc[] {
  return vault
    .filter((v) => v.expires && v.expires <= addDays(today, EXPIRY_WARNING_DAYS) && v.expires >= addDays(today, -EXPIRED_SHOWN_DAYS))
    .filter((v) => !vault.some((o) => o.id !== v.id && o.type === v.type && o.country === v.country && (o.expires == null || o.expires > v.expires!)))
    .sort((a, b) => a.expires!.localeCompare(b.expires!));
}
