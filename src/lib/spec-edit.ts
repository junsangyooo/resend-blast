/**
 * Studio editing helpers for block emails (pure, client-safe).
 *  - setBlockField: write a value at "<path>" (e.g. "items.0.title") of one block, immutably.
 *  - mergeAiResult: apply an AI result without losing hand edits made while the AI was working.
 */
import type { Block, TemplateSpec } from "./blocks";

export function getBlockField(block: Block, path: string): unknown {
  let cur: any = block;
  for (const k of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

export function setBlockField(spec: TemplateSpec, blockId: string, path: string, value: unknown): TemplateSpec {
  const keys = path.split(".");
  const setIn = (obj: any, i: number): any => {
    const k = keys[i];
    const isIdx = /^\d+$/.test(k);
    const base = Array.isArray(obj) ? [...obj] : { ...(obj ?? {}) };
    if (i === keys.length - 1) {
      (base as any)[isIdx ? Number(k) : k] = value;
      return base;
    }
    const key = isIdx ? Number(k) : k;
    (base as any)[key] = setIn((obj ?? {})[key], i + 1);
    return base;
  };
  return { ...spec, blocks: spec.blocks.map((b) => (b.id === blockId ? (setIn(b, 0) as Block) : b)) };
}

/**
 * Three-way merge for block emails.
 *  base   = spec sent to the AI, ai = AI's result, current = spec right now (may include hand edits made meanwhile).
 * Blocks the AI did not touch keep their current (hand-edited) version; blocks the AI changed take the AI version.
 * Block order, additions and removals follow the AI. Header/footer fields follow the AI only where it changed them.
 */
export function mergeAiResult(base: TemplateSpec, ai: TemplateSpec, current: TemplateSpec): TemplateSpec {
  const baseById = new Map(base.blocks.map((b) => [b.id, JSON.stringify(b)]));
  const curById = new Map(current.blocks.map((b) => [b.id, b]));
  const blocks = ai.blocks.flatMap((b) => {
    const untouchedByAi = baseById.get(b.id) === JSON.stringify(b);
    const cur = curById.get(b.id);
    if (!untouchedByAi) return [b];
    // Untouched by the AI: keep the hand-edited version — or keep it deleted if it was removed meanwhile.
    return cur ? [cur] : baseById.has(b.id) ? [] : [b];
  });
  const out: any = { ...current, blocks };
  for (const k of Object.keys({ ...base, ...ai }) as (keyof TemplateSpec)[]) {
    if (k === "blocks") continue;
    if (JSON.stringify((ai as any)[k]) !== JSON.stringify((base as any)[k])) out[k] = (ai as any)[k];
  }
  return out as TemplateSpec;
}

/** Ids of blocks whose content differs between two specs (for the "AI 변경" highlight). */
export function changedBlockIds(before: TemplateSpec, after: TemplateSpec): string[] {
  const prev = new Map(before.blocks.map((b) => [b.id, JSON.stringify(b)]));
  return after.blocks.filter((b) => prev.get(b.id) !== JSON.stringify(b)).map((b) => b.id);
}
