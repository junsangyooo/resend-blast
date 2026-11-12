"use client";
// Code view (CodeMirror 6). Controlled: external value changes are applied as minimal diffs so the
// cursor and scroll stay put while the preview is being edited. Undo/redo are the studio's, not CM's.
import { useEffect, useRef } from "react";
import { EditorState, StateEffect, StateField, Annotation } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, Decoration, type DecorationSet } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { html as htmlLang } from "@codemirror/lang-html";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";

const External = Annotation.define<boolean>();
const setHighlight = StateEffect.define<{ from: number; to: number } | null>();
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHighlight)) {
        deco = e.value && e.value.to > e.value.from
          ? Decoration.set([Decoration.mark({ class: "cm-eb-hl" }).range(e.value.from, e.value.to)])
          : Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", backgroundColor: "rgb(var(--surface, 255 255 255))" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.55" },
  ".cm-eb-hl": { backgroundColor: "rgba(245, 158, 11, 0.22)", outline: "1px solid rgba(245, 158, 11, 0.7)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "#9ca3af" },
});

/** Minimal single-span diff between two strings. */
function diff(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null;
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  return { from: s, to: ea, insert: b.slice(s, eb) };
}

export default function CodePane({ value, onChange, readOnly = false, highlight, onUndo, onRedo }: {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  /** Range to mark and scroll to (nonce re-triggers the same range). */
  highlight?: { start: number; end: number; nonce: number } | null;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onUndo, onRedo });
  cb.current = { onChange, onUndo, onRedo };

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLine(), htmlLang(), syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping, highlightField, theme,
          EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
          keymap.of([
            { key: "Mod-z", run: () => { cb.current.onUndo(); return true; } },
            { key: "Mod-Shift-z", run: () => { cb.current.onRedo(); return true; } },
            { key: "Mod-y", run: () => { cb.current.onRedo(); return true; } },
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || u.transactions.some((t) => t.annotation(External))) return;
            cb.current.onChange?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // readOnly is fixed per mount (the parent remounts on mode change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // External value → minimal change, no onChange echo.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const d = diff(v.state.doc.toString(), value);
    if (d) v.dispatch({ changes: d, annotations: External.of(true) });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (!highlight) { v.dispatch({ effects: setHighlight.of(null) }); return; }
    const len = v.state.doc.length;
    const from = Math.max(0, Math.min(highlight.start, len));
    const to = Math.max(from, Math.min(highlight.end, len));
    v.dispatch({
      effects: [setHighlight.of({ from, to }), EditorView.scrollIntoView(from, { y: "center" })],
    });
  }, [highlight]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
