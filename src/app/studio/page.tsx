"use client";
// AI Studio — left: [AI chat | code], right: fixed preview (= editor).
//  · Preview: click text → edit in place; click a link/image → change it in the input row below.
//  · Code: HTML emails are editable (live two-way with the preview); block emails are read-only (+ convert to HTML).
//  · Clicking an element in the preview jumps to and highlights its location in the code.
//  · Undo: manual edits are grouped per block/text, AI changes as one chunk (lib/studio-history).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sanitizeInline, type TemplateSpec } from "@/lib/blocks";
import { validateSpec } from "@/lib/ai/spec-validate";
import { annotateHtml, elementRanges, stripAnnotations, replaceTextRange, setElementAttr, findPreheader, setPreheader, carryTextEdits, type HtmlMap } from "@/lib/html-map";
import { setBlockField, mergeAiResult, changedBlockIds } from "@/lib/spec-edit";
import { emptyHistory, record, undo as undoH, redo as redoH, type History } from "@/lib/studio-history";
import LogoPanel, { defaultLogo } from "@/components/studio/LogoPanel";
import FooterBar from "@/components/studio/FooterBar";
import ChatPanel from "@/components/studio/ChatPanel";
import CodePane from "@/components/studio/CodePane";
import PreviewEditor, { type PreviewEdit, type PreviewHandle, type PreviewTarget } from "@/components/studio/PreviewEditor";
import GuideButton from "@/components/GuideButton";
import { formatKst, ZONE_LABEL } from "@/lib/kst";
import { EXT_BY_TYPE, MAX_UPLOAD_BYTES } from "@/lib/storage/image-validation";

type Mode = "spec" | "html";
type Snap = { mode: Mode; spec: TemplateSpec; htmlBody: string; htmlSubject: string };

/** Unsaved studio work is kept per email in this browser, so a closed tab or reload loses nothing. */
type Draft = Snap & {
  title: string;
  description: string;
  /** lastModifiedAt of the saved email this draft started from (conflict check). */
  baseModifiedAt: string | null;
  savedAt: string;
};
const draftKey = (editName: string | null) => `eb.studio.draft.${editName ?? "new"}`;
function readDraft(editName: string | null): Draft | null {
  try { const raw = localStorage.getItem(draftKey(editName)); return raw ? (JSON.parse(raw) as Draft) : null; } catch { return null; }
}
function clearDraft(editName: string | null) {
  try { localStorage.removeItem(draftKey(editName)); } catch {}
}

function skeletonSpec(): TemplateSpec {
  return { subject: "", preheader: "", showLogo: true, showFooter: true, footer: { showSocial: true, showUnsubscribe: true }, blocks: [] };
}

export default function StudioPage() {
  return <Suspense fallback={null}><Studio /></Suspense>;
}

function Studio() {
  const router = useRouter();
  const params = useSearchParams();
  const editName = params.get("edit");

  // ── document state (refs mirror state so event handlers always see the latest) ──
  const [mode, setMode] = useState<Mode>("spec");
  const [spec, setSpec] = useState<TemplateSpec>(skeletonSpec);
  const [htmlBody, setHtmlBody] = useState("");
  const [htmlSubject, setHtmlSubject] = useState("");
  const modeRef = useRef(mode); modeRef.current = mode;
  const specRef = useRef(spec); specRef.current = spec;
  const htmlRef = useRef(htmlBody); htmlRef.current = htmlBody;
  const subjRef = useRef(htmlSubject); subjRef.current = htmlSubject;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [baseModifiedAt, setBaseModifiedAt] = useState<string | null>(null);
  const [draftOffer, setDraftOffer] = useState<Draft | null>(null);
  /** Own pending schedules of this email — asked about on save (update their frozen content?). */
  const [saveAsk, setSaveAsk] = useState<{ id: string; scheduledAt: string; templateTitle?: string; templateName: string }[] | null>(null);
  const [logoOpen, setLogoOpen] = useState(false);

  // ── history ──
  const [history, setHistory] = useState<History<Snap>>(emptyHistory);
  const histRef = useRef(history); histRef.current = history;

  // ── preview / code ──
  const [leftTab, setLeftTab] = useState<"chat" | "code">("chat");
  const leftTabRef = useRef(leftTab); leftTabRef.current = leftTab;
  const [previewBody, setPreviewBody] = useState("");
  const [docKey, setDocKey] = useState(0);
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const [specCode, setSpecCode] = useState("");
  const [highlight, setHighlight] = useState<{ start: number; end: number; nonce: number } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [target, setTarget] = useState<PreviewTarget | null>(null);
  const [footerOpen, setFooterOpen] = useState(false);
  const htmlMapRef = useRef<HtmlMap>({ elements: [], texts: [] });
  const specRangesRef = useRef<HtmlMap["elements"]>([]);
  const previewRef = useRef<PreviewHandle>(null);
  const renderSeq = useRef(0);
  const aiBaseRef = useRef<Snap | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const snap = (): Snap => ({ mode: modeRef.current, spec: specRef.current, htmlBody: htmlRef.current, htmlSubject: subjRef.current });

  // ── rendering ──
  // True while the HTML changed (code view / preheader) but the preview and its index map have not been redrawn yet.
  const mapStaleRef = useRef(false);
  const reloadHtml = useCallback((body: string) => {
    const { html, map } = annotateHtml(body, { wrapText: true });
    htmlMapRef.current = map;
    mapStaleRef.current = false;
    setTarget(null); setSelectedIndex(null); setHighlight(null);
    setPreviewBody(html);
    setFlashIds([]);
    setDocKey((k) => k + 1);
  }, []);

  /** Block email: server render with field markers. reload=false only refreshes the code view. */
  const pendingReload = useRef<{ flash: string[] } | null>(null);
  const renderSpec = useCallback(async (s: TemplateSpec, opts: { reload: boolean; flash?: string[] }) => {
    const my = ++renderSeq.current;
    // A newer render must not swallow a preview reload requested by an older one.
    if (opts.reload) pendingReload.current = { flash: opts.flash ?? [] };
    const r = await fetch("/api/templates/render", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec: s, editor: true }),
    }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!r?.body || my !== renderSeq.current) return;
    const clean = stripAnnotations(r.body);
    specRangesRef.current = elementRanges(clean);
    setSpecCode(clean);
    const pr = pendingReload.current;
    if (pr) {
      pendingReload.current = null;
      setPreviewBody(annotateHtml(r.body, { wrapText: false }).html);
      setFlashIds(pr.flash);
      setDocKey((k) => k + 1);
      setSelectedIndex(null); setHighlight(null);
    }
  }, []);

  const reload = useCallback((s: Snap, flash?: string[]) => {
    if (s.mode === "html") reloadHtml(s.htmlBody);
    else renderSpec(s.spec, { reload: true, flash });
  }, [reloadHtml, renderSpec]);

  /** Put a snapshot on screen (undo/redo/AI/draft) and redraw the preview. */
  const applySnap = useCallback((s: Snap, flash?: string[]) => {
    setMode(s.mode); setSpec(s.spec); setHtmlBody(s.htmlBody); setHtmlSubject(s.htmlSubject);
    modeRef.current = s.mode; specRef.current = s.spec; htmlRef.current = s.htmlBody; subjRef.current = s.htmlSubject;
    setTarget(null); setSelectedIndex(null); setHighlight(null);
    reload(s, flash);
  }, [reload]);

  const commit = useCallback((kind: "hand" | "ai" | "other", unit: string, before: Snap, after: Snap) => {
    setHistory((h) => record(h, { kind, unit, before, after }));
    setDirty(true);
  }, []);

  // Block email code view follows hand edits (debounced, no preview reload).
  const codeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSpecCode = useCallback(() => {
    if (codeTimer.current) clearTimeout(codeTimer.current);
    codeTimer.current = setTimeout(() => { if (modeRef.current === "spec") renderSpec(specRef.current, { reload: false }); }, 500);
  }, [renderSpec]);

  // ── load ──
  useEffect(() => {
    let cancel = false;
    (async () => {
      let base: string | null = null;
      let first: Snap = { mode: "spec", spec: skeletonSpec(), htmlBody: "", htmlSubject: "" };
      if (editName) {
        const s = await fetch(`/api/templates/spec?name=${encodeURIComponent(editName)}`).then((r) => r.json()).catch(() => null);
        if (cancel) return;
        if (s?.spec) {
          first = { ...first, mode: "spec", spec: s.spec };
          setDescription(s.description ?? ""); setTitle(s.title ?? ""); base = s.lastModifiedAt ?? null;
        } else {
          const b = await fetch(`/api/templates/body?name=${encodeURIComponent(editName)}`).then((r) => r.json()).catch(() => null);
          if (cancel) return;
          if (b?.body) {
            first = { ...first, mode: "html", htmlBody: b.body, htmlSubject: b.subject ?? "" };
            setDescription(b.description ?? ""); setTitle(b.title ?? ""); base = b.lastModifiedAt ?? null;
          } else setErr("이메일 불러오기 실패");
        }
        setBaseModifiedAt(base);
      } else {
        const logo = await defaultLogo();
        if (cancel) return;
        if (logo) first = { ...first, spec: { ...first.spec, logo } };
      }
      applySnap(first);
      const d = readDraft(editName);
      if (d) setDraftOffer(d);
      setLoading(false);
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editName]);

  // ── autosave draft (1s debounce) ──
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      const d: Draft = { ...snap(), title, description, baseModifiedAt, savedAt: new Date().toISOString() };
      try { localStorage.setItem(draftKey(editName), JSON.stringify(d)); } catch {}
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, mode, spec, htmlBody, htmlSubject, title, description, baseModifiedAt, editName]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // ── undo / redo ──
  const doUndo = useCallback(() => {
    const r = undoH(histRef.current);
    if (!r) return;
    setHistory(r.history); setDirty(true); applySnap(r.state);
  }, [applySnap]);
  const doRedo = useCallback(() => {
    const r = redoH(histRef.current);
    if (!r) return;
    setHistory(r.history); setDirty(true); applySnap(r.state);
  }, [applySnap]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.closest(".cm-editor"))) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [doUndo, doRedo]);

  const codeReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── edits from the preview ──
  const onPreviewEdit = useCallback((e: PreviewEdit) => {
    const before = snap();
    if (e.kind === "field" && modeRef.current === "spec") {
      const value = e.rich ? sanitizeInline(e.value) : e.value;
      const next = setBlockField(specRef.current, e.blockId, e.path, value);
      specRef.current = next; setSpec(next);
      commit("hand", `b:${e.blockId}`, before, { ...before, spec: next });
      refreshSpecCode();
    } else if (e.kind === "text" && modeRef.current === "html") {
      if (mapStaleRef.current) {
        if (codeReloadTimer.current) clearTimeout(codeReloadTimer.current);
        reloadHtml(htmlRef.current);
        return;
      }
      const next = replaceTextRange(htmlRef.current, htmlMapRef.current, e.index, e.value);
      htmlRef.current = next; setHtmlBody(next);
      commit("hand", `t:${e.index}`, before, { ...before, htmlBody: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, refreshSpecCode, reloadHtml]);

  // ── edits from the code view (HTML emails) ──
  const onCodeChange = useCallback((v: string) => {
    const before = snap();
    htmlRef.current = v; setHtmlBody(v);
    mapStaleRef.current = true;
    commit("hand", "code", before, { ...before, htmlBody: v });
    if (codeReloadTimer.current) clearTimeout(codeReloadTimer.current);
    codeReloadTimer.current = setTimeout(() => reloadHtml(htmlRef.current), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, reloadHtml]);

  // ── click in preview → code location ──
  const onSelectElement = useCallback((index: number | null) => {
    setSelectedIndex(index);
    if (index == null) { setHighlight(null); return; }
    const ranges = modeRef.current === "html" ? htmlMapRef.current.elements : specRangesRef.current;
    const r = ranges[index];
    if (r) setHighlight({ start: r.start, end: r.end, nonce: Date.now() });
  }, []);

  // ── link / image inspector ──
  function applyTarget(attr: "href" | "src" | "alt", value: string) {
    if (!target) return;
    const before = snap();
    if (target.kind === "field-link" || target.kind === "field-image") {
      const next = setBlockField(specRef.current, target.blockId, target.path, value);
      specRef.current = next; setSpec(next);
      commit("hand", `attr:${target.blockId}:${target.path}`, before, { ...before, spec: next });
      refreshSpecCode();
    } else {
      const next = setElementAttr(htmlRef.current, htmlMapRef.current, target.index, attr, value);
      htmlRef.current = next; setHtmlBody(next);
      commit("hand", `attr:${target.index}:${attr}`, before, { ...before, htmlBody: next });
    }
    previewRef.current?.setAttr(target, attr, value);
    setTarget((t) => (t ? ({ ...t, ...(attr === "href" ? { href: value } : attr === "src" ? { src: value } : { alt: value }) } as PreviewTarget) : t));
  }

  // ── AI ──
  const onAiBusy = useCallback((b: boolean) => { if (b) aiBaseRef.current = snap(); setAiBusy(b); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** Applies the AI result and returns the chat summary line. */
  const onAiResult = useCallback((r: { spec?: unknown; html?: string }): string => {
    const before = snap();
    const baseSnap = aiBaseRef.current;
    // Switched block → HTML while the AI was working: the result belongs to the old form.
    if ((baseSnap && baseSnap.mode !== before.mode) || (r.html !== undefined) !== (before.mode === "html")) return "편집 방식 변경으로 미반영";
    if (r.html !== undefined) {
      // Hand text edits made during the run are carried over; the rest stays one undo away.
      const m = carryTextEdits(baseSnap?.htmlBody ?? before.htmlBody, before.htmlBody, r.html);
      const after = { ...before, htmlBody: m.html };
      commit("ai", "ai", before, after);
      applySnap(after);
      const head = m.html === before.htmlBody ? "변경 없음" : "HTML 반영";
      return m.missed ? `${head} · 작업 중 수정 ${m.missed}건 미반영 · 되돌리기로 복구` : head;
    }
    const v = validateSpec(r.spec);
    if (!v.ok) { setErr("AI 결과 형식 오류"); return "결과 형식 오류"; }
    const base = baseSnap?.spec ?? before.spec;
    // Hand edits made while the AI was working survive on blocks the AI did not touch.
    const merged = mergeAiResult(base, v.spec, before.spec);
    const after = { ...before, spec: merged };
    const changed = changedBlockIds(before.spec, merged);
    const removed = before.spec.blocks.filter((b) => !merged.blocks.some((x) => x.id === b.id)).length;
    commit("ai", "ai", before, after);
    applySnap(after, changed);
    // Summary of what actually changed: header fields by name, blocks by count.
    const same = (k: (s: TemplateSpec) => unknown) => JSON.stringify(k(before.spec)) === JSON.stringify(k(merged));
    const parts = [
      !same((x) => x.subject) && "제목",
      !same((x) => x.preheader ?? "") && "프리헤더",
      !same((x) => [x.showLogo, x.logo, x.tagline]) && "로고",
      !same((x) => [x.showFooter, x.footer]) && "푸터",
    ].filter(Boolean) as string[];
    const out = [
      parts.length ? `${parts.join("·")} 변경` : "",
      changed.length ? `블록 ${changed.length}개 변경` : "",
      removed ? `블록 ${removed}개 삭제` : "",
    ].filter(Boolean);
    return out.length ? out.join(" · ") : "변경 없음";
  }, [applySnap, commit]); // eslint-disable-line react-hooks/exhaustive-deps

  const getCurrent = useCallback(() => (modeRef.current === "spec" ? specRef.current : htmlRef.current), []);

  // HTML email preheader lives inside the HTML (hidden leading text) — edited in place, so code = what is sent.
  // The field keeps exactly what is typed; it re-reads the HTML only when the HTML changes elsewhere
  // (load, undo, code edits, AI) — not while the field itself is focused.
  const [htmlPreheader, setHtmlPreheaderInput] = useState("");
  const preheaderFocused = useRef(false);
  const derivedPreheader = useMemo(() => (mode === "html" ? findPreheader(htmlBody)?.text ?? "" : ""), [mode, htmlBody]);
  useEffect(() => { if (!preheaderFocused.current) setHtmlPreheaderInput(derivedPreheader); }, [derivedPreheader]);
  const onHtmlPreheader = (text: string) => {
    setHtmlPreheaderInput(text);
    const before = snap();
    const next = setPreheader(htmlRef.current, text);
    htmlRef.current = next; setHtmlBody(next);
    mapStaleRef.current = true;
    commit("hand", "preheader", before, { ...before, htmlBody: next });
    if (codeReloadTimer.current) clearTimeout(codeReloadTimer.current);
    codeReloadTimer.current = setTimeout(() => reloadHtml(htmlRef.current), 400);
  };

  // ── header/footer settings (block emails) ──
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patchSpec = useCallback((p: Partial<TemplateSpec>) => {
    const before = snap();
    const next = { ...specRef.current, ...p };
    specRef.current = next; setSpec(next);
    commit("hand", "meta", before, { ...before, spec: next });
    if (metaTimer.current) clearTimeout(metaTimer.current);
    metaTimer.current = setTimeout(() => renderSpec(specRef.current, { reload: true }), 400);
  }, [commit, renderSpec]); // eslint-disable-line react-hooks/exhaustive-deps
  const patchFooter = useCallback((p: Partial<NonNullable<TemplateSpec["footer"]>>) => {
    patchSpec({ footer: { ...specRef.current.footer, ...p } });
  }, [patchSpec]);
  // ── convert a block email to plain HTML (one-way) ──
  async function convertToHtml() {
    if (!window.confirm("HTML로 전환 · 블록 구조 삭제 · 되돌리기로만 복구 가능")) return;
    const r = await fetch("/api/templates/render", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec: specRef.current, editor: true }),
    }).then((x) => x.json()).catch(() => null);
    if (!r?.body) { setErr("HTML 전환 실패"); return; }
    const before = snap();
    const after: Snap = { ...before, mode: "html", htmlBody: stripAnnotations(r.body), htmlSubject: specRef.current.subject };
    commit("other", "convert", before, after);
    applySnap(after);
  }

  function restoreDraft(d: Draft) {
    const before = snap();
    const after: Snap = { mode: d.mode, spec: d.spec, htmlBody: d.htmlBody, htmlSubject: d.htmlSubject };
    setTitle(d.title); setDescription(d.description);
    commit("other", "draft", before, after);
    applySnap(after);
    setDraftOffer(null);
  }

  // ── save ──
  /** Save button: if this email has pending schedules of mine, ask whether to update their content too. */
  async function requestSave() {
    setErr("");
    if (editName) {
      const j = await fetch("/api/schedules").then((r) => r.json()).catch(() => null);
      const mine = (j?.schedules ?? []).filter((x: any) => x.status === "scheduled" && x.templateName === editName && x.canManage);
      if (mine.length > 0) { setSaveAsk(mine); return; }
    }
    await save(false);
  }

  async function save(updateSchedules: boolean) {
    setErr("");
    setSaving(true);
    try {
      let r: Response;
      if (modeRef.current === "spec") {
        const cur = specRef.current;
        if (!cur.subject.trim()) throw new Error("제목 필요");
        if (cur.blocks.length === 0) throw new Error("내용 없음 · 채팅으로 생성 필요");
        r = await fetch("/api/templates/compose", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: editName ?? undefined, title, spec: cur, description, overwrite: !!editName }),
        });
      } else {
        if (!subjRef.current.trim()) throw new Error("제목 필요");
        r = await fetch("/api/templates", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: editName ?? undefined, title, subject: subjRef.current, body: htmlRef.current, description, overwrite: !!editName }),
        });
      }
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error ?? "저장 실패");
      setDirty(false);
      clearDraft(editName);
      if (updateSchedules && saveAsk) {
        const failed: string[] = [];
        for (const sch of saveAsk) {
          const u = await fetch(`/api/sends/${encodeURIComponent(sch.id)}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshContent: true }),
          });
          if (!u.ok) failed.push(formatKst(sch.scheduledAt));
        }
        setSaveAsk(null);
        if (failed.length) throw new Error(`이메일 저장 완료 · 예약 내용 업데이트 실패 (${failed.join(", ")})`);
      }
      setSaveAsk(null);
      // Back to the send screen with this email selected (other selections are restored from the session).
      router.push(`/?select=${encodeURIComponent(j.name ?? editName ?? "")}`);
    } catch (e: any) { setErr(e?.message ?? "저장 실패"); } finally { setSaving(false); }
  }

  if (loading) return <div className="p-10 text-sm text-muted">불러오는 중…</div>;

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <button className="btn-ghost text-[13px]" onClick={() => { if (!dirty || window.confirm("저장하지 않고 나갈까요? (작업 내용은 임시 저장 · AI 대화는 삭제)")) router.push("/"); }}>← 발송 화면</button>
        <span className="kicker">{editName ? "이메일 편집" : "새 이메일"}{mode === "html" && " · HTML"}</span>
        {err && <span className="text-xs text-red-500">{err}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-ghost text-[13px] py-1.5" disabled={!canUndo} onClick={doUndo} title="되돌리기 (⌘Z)">↶</button>
          <button className="btn-ghost text-[13px] py-1.5" disabled={!canRedo} onClick={doRedo} title="다시 실행 (⇧⌘Z)">↷</button>
          <GuideButton />
          <button className="btn-primary text-[13px]" onClick={requestSave} disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
        </div>
      </header>

      {draftOffer && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-brand/5 px-4 py-2 text-[13px]">
          <span>임시 저장본 · {formatKst(draftOffer.savedAt)}</span>
          {editName && draftOffer.baseModifiedAt !== baseModifiedAt && (
            <span className="text-amber-700">이후 다른 곳에서 저장됨 · 이어서 하면 덮어씀</span>
          )}
          <span className="ml-auto flex gap-2">
            <button className="btn-primary text-xs" onClick={() => restoreDraft(draftOffer)}>이어서 하기</button>
            <button className="btn-ghost text-xs" onClick={() => { clearDraft(editName); setDraftOffer(null); }}>버리기</button>
          </span>
        </div>
      )}


      {/* Same row: list display name · mail subject · preheader (+ block emails: logo · footer) */}
      <div className="border-b border-border px-4 py-2 flex items-center gap-2 bg-surface2/30">
        <input className="input text-[13px] py-1.5 w-56 shrink-0" value={title} title="목록 표시 이름"
          placeholder="목록 표시 이름 (비우면 제목)" onChange={(e) => { setDirty(true); setTitle(e.target.value); }} />
        <input className="input text-[13px] py-1.5 font-semibold flex-[3] min-w-0" title="메일 제목"
          value={mode === "spec" ? spec.subject : htmlSubject} placeholder="메일 제목 *"
          onChange={(e) => {
            const v = e.target.value;
            if (mode === "spec") { patchSpec({ subject: v }); return; }
            const before = snap();
            subjRef.current = v; setHtmlSubject(v);
            commit("hand", "subject", before, { ...before, htmlSubject: v });
          }} />
        <input className="input text-[13px] py-1.5 flex-[2] min-w-0" title="프리헤더 (받은편지함 미리보기 문구)"
          onFocus={() => { preheaderFocused.current = true; }}
          onBlur={() => { preheaderFocused.current = false; setHtmlPreheaderInput(derivedPreheader); }}
          value={mode === "spec" ? spec.preheader ?? "" : htmlPreheader} placeholder="프리헤더 (받은편지함 미리보기 문구)"
          onChange={(e) => (mode === "spec" ? patchSpec({ preheader: e.target.value }) : onHtmlPreheader(e.target.value))} />
        {mode === "spec" && (
          <>
            <div className="relative shrink-0">
              <button className="btn-ghost text-[12px] py-1.5" onClick={() => { setLogoOpen((o) => !o); setFooterOpen(false); }}>로고 {logoOpen ? "▴" : "▾"}</button>
              {logoOpen && <div className="absolute right-0 top-full mt-1 z-30 w-[440px] shadow-lg"><LogoPanel spec={spec} onPatch={patchSpec} /></div>}
            </div>
            <div className="relative shrink-0">
              <button className="btn-ghost text-[12px] py-1.5" onClick={() => { setFooterOpen((o) => !o); setLogoOpen(false); }}>푸터 {footerOpen ? "▴" : "▾"}</button>
              {footerOpen && (
                <div className="absolute right-0 top-full mt-1 z-30 w-[440px] shadow-lg">
                  <FooterBar spec={spec} onPatch={patchSpec} onPatchFooter={patchFooter} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: "minmax(340px, 440px) minmax(0, 1fr)" }}>
        {/* Left: AI chat | code */}
        <section className="border-r border-border min-h-0 flex flex-col">
          <div className="flex gap-1 px-3 pt-2.5 border-b border-border shrink-0">
            {(["chat", "code"] as const).map((t) => (
              <button key={t} onClick={() => setLeftTab(t)}
                className={`text-[13px] px-3 py-1.5 -mb-px border-b-2 ${leftTab === t ? "border-brand text-brand font-semibold" : "border-transparent text-muted hover:text-text"}`}>
                {t === "chat" ? "AI 채팅" : "코드"}
              </button>
            ))}
          </div>
          {/* Chat stays mounted so the conversation survives tab switches. */}
          <div className={`flex-1 min-h-0 ${leftTab === "chat" ? "" : "hidden"}`}>
            <ChatPanel
              mode={mode}
              isNew={!editName}
              getCurrent={getCurrent}
              onResult={onAiResult}
              onBusy={onAiBusy}
              canUndoLast={history.past[history.past.length - 1]?.kind === "ai"}
              onUndoLast={doUndo}
            />
          </div>
          {leftTab === "code" && (
            <div className="flex-1 min-h-0 flex flex-col">
              {mode === "spec" && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-[12px] text-muted shrink-0">
                  <span className="flex-1">블록 이메일 · 읽기 전용</span>
                  <button className="btn-ghost text-[12px] py-1" onClick={convertToHtml}>HTML로 전환</button>
                </div>
              )}
              <div className="flex-1 min-h-0">
                <CodePane
                  key={mode}
                  value={mode === "html" ? htmlBody : specCode}
                  readOnly={mode === "spec"}
                  onChange={mode === "html" ? onCodeChange : undefined}
                  highlight={highlight}
                  onUndo={doUndo}
                  onRedo={doRedo}
                />
              </div>
            </div>
          )}
        </section>

        {/* Right: preview = editor */}
        <section className="min-h-0 flex flex-col p-3 gap-2">
          <div className="flex items-center gap-2 text-[12px] text-muted shrink-0">
            {aiBusy ? (
              <span className="flex-1 flex items-center gap-1.5 text-brand font-medium">
                <span className="w-2 h-2 rounded-full bg-brand animate-pulse" /> AI 작업 중 · 미리보기 편집 가능
              </span>
            ) : (
              <span className="flex-1">글자 클릭 시 바로 수정 · 링크·이미지 클릭 시 하단에서 변경</span>
            )}
            <button className="btn-ghost text-[12px] py-1" onMouseDown={(e) => e.preventDefault()}
              onClick={() => previewRef.current?.insertText("{{name}}")} title="커서 위치에 받는 사람 이름 삽입">＋ 이름</button>
          </div>
          <div className="relative flex-1 min-h-0">
            {aiBusy && (
              <div className="absolute inset-x-0 top-0 z-10 h-[3px] overflow-hidden rounded-t-xl">
                <div className="h-full w-1/3 bg-brand/80 animate-[ebslide_1.4s_ease-in-out_infinite]" />
              </div>
            )}
            <PreviewEditor
              ref={previewRef}
              body={previewBody}
              docKey={docKey}
              editable
              elementTargets={mode === "html"}
              flashBlockIds={flashIds}
              selectedIndex={leftTab === "code" ? selectedIndex : null}
              onEdit={onPreviewEdit}
              onSelectElement={onSelectElement}
              onTarget={setTarget}
              onUndo={doUndo}
              onRedo={doRedo}
            />
          </div>
          {target && <TargetBar target={target} onApply={applyTarget} onClose={() => setTarget(null)} />}
        </section>
      </div>

      {saveAsk && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setSaveAsk(null)}>
          <div className="card w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">이메일을 사용하는 예약 {saveAsk.length}건</h3>
            <ul className="text-[13px] space-y-1 max-h-40 overflow-y-auto">
              {saveAsk.map((s) => (
                <li key={s.id} className="flex justify-between gap-3">
                  <span className="truncate">{s.templateTitle ?? s.templateName}</span>
                  <span className="text-muted shrink-0 tabular-nums">{formatKst(s.scheduledAt)} {ZONE_LABEL}</span>
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-text/80">예약된 발송의 내용도 함께 업데이트하시겠습니까?</p>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost text-sm" onClick={() => setSaveAsk(null)}>취소</button>
              <button className="btn-ghost text-sm" disabled={saving} onClick={() => save(false)} title="이메일만 저장 · 예약은 기존 내용">이메일만 수정</button>
              <button className="btn-primary text-sm" disabled={saving} onClick={() => save(true)} title="이메일 저장 + 예약 내용 업데이트">확인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Link / image inspector under the preview. */
function TargetBar({ target, onApply, onClose }: {
  target: PreviewTarget;
  onApply: (attr: "href" | "src" | "alt", value: string) => void;
  onClose: () => void;
}) {
  const isLink = target.kind === "field-link" || target.kind === "el-link";
  const initial = isLink ? (target as any).href : (target as any).src;
  const [value, setValue] = useState<string>(initial ?? "");
  const [alt, setAlt] = useState<string>(target.kind === "el-image" ? target.alt : "");
  const [uploading, setUploading] = useState(false);
  useEffect(() => { setValue(initial ?? ""); if (target.kind === "el-image") setAlt(target.alt); }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const [uploadErr, setUploadErr] = useState("");
  async function upload(file: File) {
    setUploadErr("");
    if (!(file.type in EXT_BY_TYPE) || file.size > MAX_UPLOAD_BYTES) {
      setUploadErr(`지원 형식 PNG·JPG·GIF·WEBP · ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 이하`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (r.ok && j.url) { setValue(j.url); onApply("src", j.url); }
      else setUploadErr(j.error ?? "업로드 실패");
    } catch { setUploadErr("업로드 실패"); } finally { setUploading(false); }
  }

  return (
    <div className="shrink-0 rounded-xl border border-border bg-surface px-3 py-2 flex flex-wrap items-center gap-2 text-[13px]">
      <span className="chip">{isLink ? "링크" : "이미지"}</span>
      <input className="input py-1 text-[12.5px] font-mono flex-1 min-w-[220px]" value={value} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onApply(isLink ? "href" : "src", value.trim()); }} placeholder={isLink ? "https://…" : "이미지 주소"} />
      <button className="btn-primary text-xs" onClick={() => onApply(isLink ? "href" : "src", value.trim())}>적용</button>
      {!isLink && (
        <label className="btn-ghost text-xs cursor-pointer">
          {uploading ? "업로드 중…" : "파일로 교체"}
          <input type="file" accept={Object.keys(EXT_BY_TYPE).join(",")} className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }} />
        </label>
      )}
      {target.kind === "el-image" && (
        <input className="input py-1 text-[12.5px] w-40" value={alt} onChange={(e) => setAlt(e.target.value)}
          onBlur={() => onApply("alt", alt)} placeholder="대체 텍스트" />
      )}
      {uploadErr && <span className="text-[12px] text-red-500 basis-full">{uploadErr}</span>}
      <button className="icon-btn text-muted" onClick={onClose} aria-label="닫기">✕</button>
    </div>
  );
}
