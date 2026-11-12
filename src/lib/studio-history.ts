/**
 * Studio undo/redo model (pure).
 *
 * Team rules:
 *  - Hand edits are grouped per unit (a block, or one text in an HTML email): consecutive edits to the
 *    same unit merge into one undo step.
 *  - An AI change is always its own single step. Undoing it restores the state right before the AI
 *    result was applied — so hand edits made while the AI was working are kept.
 *  - Otherwise undo is sequential.
 */

export type Entry<T> = { kind: "hand" | "ai" | "other"; unit: string; before: T; after: T };
export type History<T> = { past: Entry<T>[]; future: Entry<T>[] };

export const emptyHistory = <T,>(): History<T> => ({ past: [], future: [] });

const MAX = 200;

/** Record a change. Hand edits to the same unit as the previous entry merge into it. */
export function record<T>(h: History<T>, e: Entry<T>): History<T> {
  const last = h.past[h.past.length - 1];
  if (e.kind === "hand" && last && last.kind === "hand" && last.unit === e.unit) {
    return { past: [...h.past.slice(0, -1), { ...last, after: e.after }], future: [] };
  }
  const past = [...h.past, e];
  return { past: past.length > MAX ? past.slice(past.length - MAX) : past, future: [] };
}

export function undo<T>(h: History<T>): { history: History<T>; state: T } | null {
  const e = h.past[h.past.length - 1];
  if (!e) return null;
  return { history: { past: h.past.slice(0, -1), future: [e, ...h.future] }, state: e.before };
}

export function redo<T>(h: History<T>): { history: History<T>; state: T } | null {
  const e = h.future[0];
  if (!e) return null;
  return { history: { past: [...h.past, e], future: h.future.slice(1) }, state: e.after };
}
