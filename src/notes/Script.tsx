// A screenplay laid out the way it prints: Courier, with the industry's indents.

import type { ScriptLine } from '../../shared/docs/types.ts';

const UPPER = new Set(['sceneHeading', 'character', 'transition', 'shot', 'actHeading', 'endOfAct']);

export function Script({ title, lines }: { title: string | null; lines: ScriptLine[] }) {
  return (
    <article className="script-page">
      {title ? <h1 className="script-title">{title}</h1> : null}
      {lines.map((l, i) => (
        <p key={i} className={`sl sl-${l.type}`} style={l.align ? { textAlign: l.align } : undefined}>
          {UPPER.has(l.type) ? l.text.toUpperCase() : l.text || ' '}
        </p>
      ))}
    </article>
  );
}
