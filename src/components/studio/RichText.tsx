"use client";
// 선택 시에만 뜨는 미니 서식 툴바 + contentEditable 필드.
// 커밋 값은 항상 sanitizeInline 통과 — raw HTML 이 state 에 들어가지 않는다.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { sanitizeInline } from "@/lib/blocks";
import { brand } from "@/brand.config";

type Ctx = { attach: (el: HTMLElement, commit: (h: string) => void) => void };
const RtCtx = createContext<Ctx | null>(null);

export function RichTextProvider({ children }: { children: React.ReactNode }) {
  const barRef = useRef<HTMLDivElement>(null);
  const target = useRef<{ el: HTMLElement; commit: (h: string) => void } | null>(null);
  const [linkInput, setLinkInput] = useState<string | null>(null);
  // mousedown 핸들러는 [] 로 1회 등록 — linkInput 상태를 ref 로 미러링해 참조한다.
  const linkOpenRef = useRef(false);
  useEffect(() => { linkOpenRef.current = linkInput !== null; }, [linkInput]);
  // 링크 입력이 취소되면 임시 앵커를 되돌릴 수 있게 대상 필드를 기억한다.
  const pendingTarget = useRef<{ el: HTMLElement; commit: (h: string) => void } | null>(null);
  const PENDING = "https://pending-link.invalid/edit";

  const attach = useCallback((el: HTMLElement, commit: (h: string) => void) => {
    const s = window.getSelection(); const bar = barRef.current;
    if (!bar) return;
    if (!s || s.rangeCount === 0 || s.isCollapsed || !el.contains(s.anchorNode)) { bar.style.display = "none"; return; }
    target.current = { el, commit };
    const r = s.getRangeAt(0).getBoundingClientRect();
    // position:fixed — getBoundingClientRect 는 viewport 기준이라 scroll 보정 불필요.
    bar.style.display = "flex";
    bar.style.top = `${r.top - 44}px`;
    bar.style.left = `${Math.max(8, r.left + r.width / 2 - 120)}px`;
  }, []);

  function fmt(cmd: string, val?: string) {
    document.execCommand(cmd, false, val);
    // t.commit 은 RichText 쪽에서 sanitizeInline 을 거친다 — 여기서 이중 sanitize 하지 않는다.
    const t = target.current; if (t) t.commit(t.el.innerHTML);
  }
  // sanitize 전(raw execCommand)·후(target/rel/style 재작성) 형태 모두 href 값만으로 매칭.
  function unwrapPending(html: string): string {
    return html.replace(/<a\s[^>]*href="https:\/\/pending-link\.invalid\/edit"[^>]*>([\s\S]*?)<\/a>/gi, "$1");
  }
  function cancelPendingLink() {
    const t = pendingTarget.current;
    pendingTarget.current = null;
    setLinkInput(null);
    if (!t) return;
    t.el.innerHTML = unwrapPending(t.el.innerHTML);
    t.commit(t.el.innerHTML);
  }
  function openLink() {
    fmt("createLink", PENDING);
    pendingTarget.current = target.current;
    setLinkInput("https://");
  }
  function applyLink() {
    const t = pendingTarget.current; const url = (linkInput ?? "").trim();
    if (!t || !/^(https?:\/\/|mailto:)/i.test(url)) {
      cancelPendingLink();
      if (barRef.current) barRef.current.style.display = "none";
      return;
    }
    pendingTarget.current = null;
    setLinkInput(null);
    t.el.innerHTML = t.el.innerHTML.split(PENDING).join(url);
    t.commit(t.el.innerHTML);
    if (barRef.current) barRef.current.style.display = "none";
  }

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const bar = barRef.current;
      if (bar && !bar.contains(e.target as Node)) {
        bar.style.display = "none";
        if (linkOpenRef.current) cancelPendingLink();
        else setLinkInput(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const btn = "w-7 h-7 rounded flex items-center justify-center text-[12px] hover:bg-surface2";
  return (
    <RtCtx.Provider value={{ attach }}>
      {children}
      <div ref={barRef} style={{ display: "none", position: "fixed", zIndex: 60 }}
        className="items-center gap-0.5 rounded-lg border border-border bg-surface shadow-lg px-1 py-1">
        {linkInput === null ? (<>
          <button className={btn} style={{ fontWeight: 800 }} onMouseDown={(e) => { e.preventDefault(); fmt("bold"); }}>B</button>
          <button className={btn} style={{ fontStyle: "italic" }} onMouseDown={(e) => { e.preventDefault(); fmt("italic"); }}>I</button>
          <button className={btn} style={{ textDecoration: "underline" }} onMouseDown={(e) => { e.preventDefault(); fmt("underline"); }}>U</button>
          <button className={btn} style={{ textDecoration: "line-through" }} onMouseDown={(e) => { e.preventDefault(); fmt("strikeThrough"); }}>S</button>
          <span className="w-px h-4 bg-border mx-0.5" />
          <button className={btn} title="브랜드색" onMouseDown={(e) => { e.preventDefault(); fmt("foreColor", brand.email.colors.teal); }}>
            <span className="w-3.5 h-3.5 rounded-full" style={{ background: brand.email.colors.teal }} />
          </button>
          <button className={btn} title="색 해제" onMouseDown={(e) => { e.preventDefault(); fmt("foreColor", brand.email.colors.body); }}>⊘</button>
          <span className="w-px h-4 bg-border mx-0.5" />
          <button className={`${btn} w-auto px-1.5`} onMouseDown={(e) => { e.preventDefault(); openLink(); }}>🔗</button>
        </>) : (<>
          <input autoFocus value={linkInput} onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } if (e.key === "Escape") { e.stopPropagation(); cancelPendingLink(); } }}
            className="input h-7 w-52 text-[12px]" placeholder="https://… 또는 mailto:" />
          <button className={`${btn} w-auto px-1.5`} onMouseDown={(e) => { e.preventDefault(); applyLink(); }}>적용</button>
        </>)}
      </div>
    </RtCtx.Provider>
  );
}

export function RichText({ value, onCommit, placeholder, className }: {
  value: string; onCommit: (html: string) => void; placeholder?: string; className?: string;
}) {
  const ctx = useContext(RtCtx);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const safe = sanitizeInline(value);
    if (document.activeElement !== el && el.innerHTML !== safe) el.innerHTML = safe;
  });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const commit = (h: string) => onCommit(sanitizeInline(h));
  const notify = () => { const el = ref.current; if (el && ctx) ctx.attach(el, commit); };
  return (
    <div ref={ref} contentEditable suppressContentEditableWarning data-ph={placeholder}
      className={`rtField ${className ?? ""}`}
      onBlur={(e) => { if (timer.current) clearTimeout(timer.current); commit(e.currentTarget.innerHTML); }}
      onInput={(e) => {
        const v = e.currentTarget.innerHTML;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), 400);
      }}
      onMouseUp={notify} onKeyUp={notify} />
  );
}
