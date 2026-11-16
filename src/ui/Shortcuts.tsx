// "?" from anywhere: every keyboard shortcut, by where it works. Keep this in
// step with the handlers it describes (useKey calls and the boards' keydowns).

import { useSyncExternalStore } from 'react';
import { useKey } from '../lib/hooks.ts';
import { mod, paletteKey } from '../lib/keys.ts';
import { Sheet } from './Sheet.tsx';

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: 'Anywhere',
    keys: [
      [[paletteKey], 'Jump to, start or find anything'],
      [['/'], 'Search documents'],
      [['I'], 'Capture an idea'],
      [['1', '…', '5'], "Switch between an area's sections"],
      [['?'], 'Show these shortcuts'],
    ],
  },
  {
    title: 'Work boards',
    keys: [
      [['N'], 'New card'],
      [['Space'], 'Peek at the card under the pointer, or close the peek'],
      [['J', 'K'], 'Next and previous card in the peek'],
      [['Alt', '←', '→'], 'Move a card to the next or previous column'],
      [['Alt', '↑', '↓'], 'Move a card up or down its column'],
      [['Alt', 'Shift', '↑', '↓'], 'Send a card to the top or bottom'],
      [['Esc'], 'Put back a field, then close the peek'],
    ],
  },
  {
    title: 'Calendar',
    keys: [
      [['←', '→'], 'Previous and next week or month'],
      [['T'], 'Today'],
      [['W', 'M', 'A'], 'Week, month or agenda'],
      [['N'], 'New event'],
    ],
  },
  {
    title: 'Elsewhere',
    keys: [
      [['N'], 'New entry in Money, a title on the Watchlist, or a recipe in Recipes'],
      [[mod, 'S'], 'Save the note being edited'],
    ],
  },
];

let open = false;
const subs = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  subs.forEach((s) => s());
};
export const openShortcuts = () => setOpen(true);

export function ShortcutsHost() {
  const isOpen = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => open,
  );
  useKey('?', (e) => {
    if (document.querySelector('.sheet')) return;
    e.preventDefault();
    setOpen(true);
  });
  if (!isOpen) return null;
  return (
    <Sheet title="Keyboard shortcuts" onClose={() => setOpen(false)}>
      <div className="shortcuts">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="block-title">{g.title}</h3>
            <dl>
              {g.keys.map(([keys, what]) => (
                <div key={what} className="shortcut">
                  <dt>{what}</dt>
                  <dd>
                    {keys.map((k) => (k === '…' ? <span key={k} className="faint">…</span> : <kbd key={k}>{k}</kbd>))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
