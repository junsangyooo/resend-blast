"use client";
// Right-side preview that is also the editor: click text to edit it in place; click a link or image to
// change its target/source in the inspector bar below. The iframe is reloaded only when `docKey`
// changes (AI result, code edit, undo…) — edits made here never reload it, so the caret stays.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type PreviewEdit =
  | { kind: "field"; blockId: string; path: string; rich: boolean; value: string }
  | { kind: "text"; index: number; value: string };
export type PreviewTarget =
  | { kind: "field-link"; blockId: string; path: string; href: string }
  | { kind: "field-image"; blockId: string; path: string; src: string }
  | { kind: "el-link"; index: number; href: string }
  | { kind: "el-image"; index: number; src: string; alt: string };

export type PreviewHandle = {
  insertText: (text: string) => void;
  setAttr: (target: PreviewTarget, attr: "href" | "src" | "alt", value: string) => void;
};

const EDITOR_CSS = `
[data-eb-f], [data-eb-t] { outline: 1px dashed transparent; outline-offset: 2px; border-radius: 2px; }
[data-eb-f]:hover, [data-eb-t]:hover { outline-color: rgba(15,157,138,.55); cursor: text; }
[data-eb-f]:focus, [data-eb-t]:focus { outline: 2px solid #0f9d8a; }
a, img { cursor: pointer; }
.eb-sel { outline: 2px solid #f59e0b !important; outline-offset: 2px; }
.eb-flash { outline: 2px solid #0f9d8a !important; outline-offset: -2px; transition: outline-color 1.2s; }
`;

type Props = {
  body: string;
  docKey: number;
  editable: boolean;
  /** HTML emails: any link/image is editable by source position. Block emails: only block fields (false). */
  elementTargets: boolean;
  /** Blocks to briefly outline after load (AI changes). */
  flashBlockIds?: string[];
  /** Element index (data-eb-e) to outline — mirrors the code selection. */
  selectedIndex?: number | null;
  onEdit: (e: PreviewEdit) => void;
  onSelectElement: (index: number | null) => void;
  onTarget: (t: PreviewTarget | null) => void;
  onUndo: () => void;
  onRedo: () => void;
};

const PreviewEditor = forwardRef<PreviewHandle, Props>(function PreviewEditor(props, ref) {
  const { body, docKey, selectedIndex } = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const cb = useRef(props);
  cb.current = props;
  const scrollY = useRef(0);
  const [srcDoc, setSrcDoc] = useState("");

  // Reload only on docKey change (remember scroll so the view does not jump).
  useEffect(() => {
    try { scrollY.current = frame.current?.contentWindow?.scrollY ?? 0; } catch {}
    setSrcDoc(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${EDITOR_CSS}</style></head>` +
      `<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;-webkit-font-smoothing:antialiased;">${body}</body></html>` +
      // Unique per reload: an identical srcdoc (e.g. undo back to the loaded content) would not reload the frame,
      // leaving in-place edits on screen.
      `<!--eb-${docKey}-->`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  function onLoad() {
    const doc = frame.current?.contentDocument;
    const win = frame.current?.contentWindow;
    if (!doc || !win) return;
    try { win.scrollTo(0, scrollY.current); } catch {}

    if (cb.current.editable) {
      doc.querySelectorAll<HTMLElement>("[data-eb-t], [data-eb-f]").forEach((el) => {
        const rich = el.getAttribute("data-eb-k") === "rich";
        el.setAttribute("contenteditable", rich ? "true" : "plaintext-only");
        el.setAttribute("spellcheck", "false");
      });
    }

    const editableOf = (t: EventTarget | null) =>
      (t instanceof (win as any).Element ? (t as Element).closest("[data-eb-t], [data-eb-f]") : null) as HTMLElement | null;

    doc.addEventListener("input", (ev) => {
      const el = editableOf(ev.target);
      if (!el) return;
      const t = el.getAttribute("data-eb-t");
      if (t !== null) {
        cb.current.onEdit({ kind: "text", index: Number(t), value: el.textContent ?? "" });
        return;
      }
      const f = el.getAttribute("data-eb-f");
      if (!f) return;
      const i = f.indexOf(":");
      const rich = el.getAttribute("data-eb-k") === "rich";
      // innerText would apply CSS text-transform (e.g. uppercase kicker) — read the DOM text instead.
      const value = rich ? el.innerHTML : plainTextOf(el).replace(/\n$/, "");
      cb.current.onEdit({ kind: "field", blockId: f.slice(0, i), path: f.slice(i + 1), rich, value });
    });

    doc.addEventListener("keydown", (ev) => {
      const k = ev.key.toLowerCase();
      if ((ev.metaKey || ev.ctrlKey) && k === "z") {
        ev.preventDefault();
        if (ev.shiftKey) cb.current.onRedo(); else cb.current.onUndo();
        return;
      }
      if ((ev.metaKey || ev.ctrlKey) && k === "y") { ev.preventDefault(); cb.current.onRedo(); return; }
      if (ev.key === "Enter") {
        const el = editableOf(ev.target);
        if (!el) return;
        ev.preventDefault();
        // Rich text: a line break. Single-line text in an HTML email: Enter does nothing.
        if (el.getAttribute("data-eb-k") === "rich" || (el.hasAttribute("data-eb-f") && ev.shiftKey)) {
          doc.execCommand("insertLineBreak");
        }
      }
    });

    // Paste as plain text (no foreign markup sneaks into the email). Rich text keeps line breaks as <br>.
    doc.addEventListener("paste", (ev) => {
      const el = editableOf(ev.target);
      if (!el) return;
      ev.preventDefault();
      const text = (ev.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
      if (el.getAttribute("data-eb-k") === "rich") {
        const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        doc.execCommand("insertHTML", false, esc.replace(/\n/g, "<br>"));
      } else {
        doc.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " "));
      }
    });

    doc.addEventListener("click", (ev) => {
      const target = ev.target as Element;
      const a = target.closest?.("a");
      if (a) ev.preventDefault(); // never navigate inside the editor
      const elIdx = target.closest?.("[data-eb-e]")?.getAttribute("data-eb-e");
      cb.current.onSelectElement(elIdx != null ? Number(elIdx) : null);

      const img = target.closest?.("img");
      if (img) {
        const fi = img.getAttribute("data-eb-i");
        if (fi) {
          const i = fi.indexOf(":");
          cb.current.onTarget({ kind: "field-image", blockId: fi.slice(0, i), path: fi.slice(i + 1), src: img.getAttribute("src") ?? "" });
        } else if (cb.current.elementTargets && img.getAttribute("data-eb-e") != null) {
          cb.current.onTarget({ kind: "el-image", index: Number(img.getAttribute("data-eb-e")), src: img.getAttribute("src") ?? "", alt: img.getAttribute("alt") ?? "" });
        } else {
          cb.current.onTarget(null);
        }
        return;
      }
      if (a) {
        const fl = a.getAttribute("data-eb-l");
        if (fl) {
          const i = fl.indexOf(":");
          cb.current.onTarget({ kind: "field-link", blockId: fl.slice(0, i), path: fl.slice(i + 1), href: a.getAttribute("href") ?? "" });
        } else if (cb.current.elementTargets && a.getAttribute("data-eb-e") != null) {
          cb.current.onTarget({ kind: "el-link", index: Number(a.getAttribute("data-eb-e")), href: a.getAttribute("href") ?? "" });
        } else {
          cb.current.onTarget(null);
        }
        return;
      }
      cb.current.onTarget(null);
    });

    for (const id of cb.current.flashBlockIds ?? []) {
      const el = doc.querySelector(`[data-eb-b="${CSS.escape(id)}"]`);
      if (!el) continue;
      el.classList.add("eb-flash");
      setTimeout(() => el.classList.remove("eb-flash"), 2500);
    }
    applySelection();
  }

  function applySelection() {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll(".eb-sel").forEach((n) => n.classList.remove("eb-sel"));
    if (selectedIndex == null) return;
    doc.querySelector(`[data-eb-e="${selectedIndex}"]`)?.classList.add("eb-sel");
  }
  useEffect(applySelection);

  useImperativeHandle(ref, () => ({
    insertText(text: string) {
      const win = frame.current?.contentWindow;
      const doc = frame.current?.contentDocument;
      if (!win || !doc) return;
      win.focus();
      doc.execCommand("insertText", false, text);
    },
    setAttr(target, attr, value) {
      const doc = frame.current?.contentDocument;
      if (!doc) return;
      let el: Element | null = null;
      if (target.kind === "field-link") el = doc.querySelector(`[data-eb-l="${target.blockId}:${target.path}"]`);
      else if (target.kind === "field-image") el = doc.querySelector(`[data-eb-i="${target.blockId}:${target.path}"]`);
      else el = doc.querySelector(`[data-eb-e="${target.index}"]`);
      el?.setAttribute(attr, value);
    },
  }));

  return (
    <iframe
      ref={frame}
      title="editor-preview"
      sandbox="allow-same-origin"
      onLoad={onLoad}
      srcDoc={srcDoc}
      className="w-full h-full rounded-xl border border-border bg-white"
    />
  );
});

export default PreviewEditor;

/** Text of an editable element as typed: <br> and block children become line breaks; ignores CSS text-transform. */
function plainTextOf(el: Element): string {
  let out = "";
  const walk = (n: Node) => {
    if (n.nodeType === 3) { out += n.nodeValue ?? ""; return; }
    const tag = (n as Element).tagName;
    if (tag === "BR") { out += "\n"; return; }
    const block = tag === "DIV" || tag === "P";
    if (block && out && !out.endsWith("\n")) out += "\n";
    n.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return out;
}
