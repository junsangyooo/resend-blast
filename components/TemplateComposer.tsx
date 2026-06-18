"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useEscClose } from "./hooks";
import {
  type Block, type BlockType, type TemplateSpec, type GridCard, type Align, type CardType,
  BLOCK_PALETTE, emptyBlock, newId, sanitizeInline,
  GAP_PX, resolveStyle, resolveButtonColors, specWidthPx, renderTemplate,
} from "@/lib/blocks";
import { brand } from "@/brand.config";

/* ── tokens (brand.config.ts 의 email.colors 와 동기화) ── */
const C = brand.email.colors;
const MONO = brand.email.mono;
const CO = brand.identity.companyName; // 프리셋·푸터 표시용 회사명
const BRAND_SW = [
  { k: "ink", v: C.ink, n: "먹색" }, { k: "body", v: C.body, n: "본문" },
  { k: "teal", v: C.teal, n: "브랜드" }, { k: "muted", v: C.muted, n: "옅은" },
];
// 버튼 배경 색 토큰 (lib/blocks.ts BUTTON_COLORS 와 동일 키)
const BTN_SW = [
  { k: "mint", v: C.mint, n: "민트" },
  { k: "teal", v: C.teal, n: "틸" },
  { k: "ink", v: C.ink, n: "잉크" },
];
const TLAB: Record<BlockType, string> = {
  heading: "제목", text: "본문", button: "버튼", badge: "날짜 배지", kicker: "작은 라벨",
  numbered: "번호 목록", agenda: "어젠다 표", grid: "그리드", image: "이미지", divider: "구분선",
};
const CARD_TYPES: [CardType, string][] = [["feature", "피처"], ["image", "이미지"], ["stat", "지표"], ["cta", "CTA"]];
// 블록별 선택 구성요소
const COMPOSE: Partial<Record<BlockType, [keyof Block, string][]>> = {
  heading: [["subnote", "아래 부제 코멘트"]],
  button: [["topNote", "위 코멘트"], ["bottomNote", "아래 코멘트"]],
  badge: [["bottomNote", "아래 코멘트"]],
  numbered: [["title", "제목"], ["titleNote", "제목 밑 코멘트"], ["bottomNote", "맨 아래 코멘트"]],
  agenda: [["title", "제목"], ["titleNote", "제목 밑 코멘트"], ["bottomNote", "맨 아래 코멘트"]],
  image: [["title", "상단 제목"], ["caption", "하단 코멘트"]],
};

type Logo = { id: string; label: string; url: string; width: number };

/* ── line icons ── */
const P: Record<string, string> = {
  heading: '<path d="M6 5v14M18 5v14M6 12h12"/>', text: '<path d="M4 7h16M4 12h16M4 17h11"/>',
  button: '<rect x="3" y="8" width="18" height="9" rx="4.5"/><path d="M9 12.5h6"/>',
  badge: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>',
  kicker: '<path d="M5 8h6M5 13h14M5 17h14"/>', numbered: '<path d="M10 7h10M10 12h10M10 17h10"/><path d="M4.4 6l1.2-.6v3.6M4.4 9h2.4"/>',
  agenda: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.6 1.6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M20 15l-4.5-4.5L7 19"/>',
  divider: '<path d="M4 12h16"/>', up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', edit: '<path d="M4 20h4L18 10l-4-4L4 16v4zM14 6l4 4"/>',
};
function Icon({ n }: { n: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: P[n] }} />;
}

/* ── presets ── */
function mk(type: BlockType, props: Partial<Block> = {}): Block { return { id: newId(), type, ...props } as Block; }
const PRESETS: { id: string; t: string; d: string; goal: string; make: () => TemplateSpec }[] = [
  { id: "invite", t: "행사 초청", d: "라벨·대제목·날짜 배지·CTA", goal: "외부 게스트를 행사에 초대할 때", make: () => ({ subject: `[초청] ${CO} Demo Day`, preheader: "서울에서 열리는 첫 공개 데모", showLogo: true, showFooter: true, footer: { showSocial: true, showUnsubscribe: true }, blocks: [
    mk("kicker", { text: "YOU'RE INVITED" }), mk("heading", { text: `${CO} Demo Day`, size: "L" }),
    mk("badge", { line1: "2026. 6. 10 (화) 오후 4시", line2: "라움아트센터, 서울" }),
    mk("text", { html: `{{name|Roboticist}}님을 ${CO}의 첫 공개 데모데이에 초대합니다.<br>현장에서 라이브 데모와 네트워킹이 준비되어 있습니다.` }),
    mk("button", { label: "참가 신청하기", url: "", arrow: false }),
    mk("divider", { gap: "lg" }),
    mk("text", { size: "S", color: "muted", align: "center", html: "좌석이 한정되어 있어 선착순으로 마감됩니다." })] }) },
  { id: "reminder", t: "D-1 리마인더", d: "어젠다 표 + 오시는 길", goal: "신청자에게 행사 전날 안내할 때", make: () => ({ subject: "[D-1] 내일 행사 안내", preheader: "내일 오후 4시, 라움아트센터", showLogo: true, showFooter: true, footer: { showSocial: true, showUnsubscribe: true }, blocks: [
    mk("kicker", { text: "REMINDER · D-1" }), mk("heading", { text: "내일 뵙겠습니다 👋" }),
    mk("text", { html: "{{firstName|게스트}}님, 신청하신 행사가 <strong>내일</strong>입니다." }),
    mk("badge", { line1: "오후 4시 시작 · 3시 30분부터 입장", line2: "라움아트센터, 서울" }),
    mk("agenda", { title: "Agenda", rows: [{ time: "3:30 PM", label: "등록·네트워킹" }, { time: "4:00 PM", label: "키노트" }, { time: "5:00 PM", label: "라이브 데모" }] }),
    mk("button", { label: "오시는 길", url: "", arrow: false })] }) },
  { id: "news", t: "뉴스레터", d: "번호 목록 + 하이라이트 카드", goal: "월간 소식·업데이트를 정기 발송할 때", make: () => ({ subject: `${CO} 5월 소식`, preheader: "이번 달 주요 업데이트", showLogo: true, showFooter: true, footer: { showSocial: true, showUnsubscribe: true }, blocks: [
    mk("kicker", { text: "MONTHLY UPDATE" }), mk("heading", { text: `5월의 ${CO}` }),
    mk("numbered", { items: [{ title: "RLDX-1 공개", desc: "첫 파운데이션 모델" }, { title: "데모데이", desc: "6월 10일" }, { title: "채용 확대", desc: "전 직군" }] }),
    mk("divider"),
    mk("grid", { cols: 2, cardType: "stat", cards: [{ value: "120+", title: "데모 신청" }, { value: "8", title: "신규 파트너" }] }),
    mk("button", { label: "전체 소식 보기", url: "", arrow: false })] }) },
  { id: "notice", t: "공지", d: "간결 안내 + 일정 배지", goal: "점검·정책 등 공지를 보낼 때", make: () => ({ subject: "[공지] 서비스 점검", preheader: "6월 3일 새벽 점검 예정", showLogo: true, showFooter: true, footer: { showSocial: false, showUnsubscribe: true }, blocks: [
    mk("heading", { text: "서비스 점검 안내" }),
    mk("text", { html: "안녕하세요 {{name|고객}}님. 더 나은 서비스를 위해 점검을 진행합니다." }),
    mk("badge", { line1: "2026. 6. 3 (수) 02:00~04:00", line2: "점검 중 접속 불가" }),
    mk("text", { size: "S", color: "muted", align: "center", html: "점검 시간은 사정에 따라 변경될 수 있습니다." })] }) },
];

function emptySpec(): TemplateSpec {
  return { subject: "", preheader: "", showLogo: true, showFooter: true, tagline: "", footer: { showSocial: true, showUnsubscribe: true }, blocks: [] };
}

/* ── tree helpers ──
 * 스타일 결정(resolveStyle)·간격(GAP_PX)·버튼 색은 lib/blocks.ts(실제 렌더러)에서 import —
 * 캔버스와 발송 HTML 이 어긋나는 이중 구현을 금지한다. */
const SIZEPX = { S: { heading: 16, text: 13 }, M: { heading: 20, text: 14.5 }, L: { heading: 34, text: 15.5 } } as const;

/* ── Editable: uncontrolled contentEditable (커서 유지) ──
 * 입력 중에도 ~400ms 디바운스로 state 에 커밋한다 — blur 없이 저장/미리보기를 눌러도
 * 마지막 편집이 유실되지 않게 (Safari 의 버튼 클릭 시 blur 미발생 케이스 방어).
 * focus 중에는 위 effect 가 DOM 을 건드리지 않으므로 캐럿·한글 IME 조합이 깨지지 않는다. */
function Editable({ value, html, onCommit, onLive, ph, style, className, onSelect }: {
  value?: string; html?: string; onCommit: (v: string) => void; onLive?: (v: string) => void;
  ph?: string; style?: React.CSSProperties; className?: string; onSelect?: (el: HTMLElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHtml = html !== undefined;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const incoming = isHtml ? (html || "") : (value || "");
    if (document.activeElement !== el) {
      if (isHtml) { if (el.innerHTML !== incoming) el.innerHTML = incoming; }
      else { if (el.textContent !== incoming) el.textContent = incoming; }
    }
  });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <div ref={ref} contentEditable suppressContentEditableWarning className={className} data-ph={ph} style={style}
      onBlur={(e) => { if (timer.current) clearTimeout(timer.current); onCommit(isHtml ? e.currentTarget.innerHTML : e.currentTarget.innerText); }}
      onInput={(e) => {
        const v = isHtml ? e.currentTarget.innerHTML : e.currentTarget.innerText;
        onLive?.(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onCommit(v), 400);
      }}
      onMouseUp={() => onSelect?.(ref.current!)} onKeyUp={() => onSelect?.(ref.current!)}
      onClick={(e) => e.stopPropagation()} />
  );
}

export default function TemplateComposer({ open, editName, onClose, onSaved }: {
  open: boolean; editName?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [spec, setSpec] = useState<TemplateSpec>(emptySpec);
  const [started, setStarted] = useState(false); // 신규: 시작 화면(템플릿 선택) → true 면 편집기
  const [sel, setSel] = useState<string | null>(null);
  const [insMode, setInsMode] = useState<"block" | "mail">("mail");
  const [addAt, setAddAt] = useState<number | null>(null);
  const [drag, setDrag] = useState<BlockType | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [help, setHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [logos, setLogos] = useState<Logo[]>([]);
  const [existing, setExisting] = useState<{ name: string; archived: boolean }[]>([]);
  const [undoBlk, setUndoBlk] = useState<{ block: Block; idx: number } | null>(null);
  const rtRef = useRef<HTMLDivElement>(null);
  const rtTargetId = useRef<string | null>(null);
  // 저장/미리보기 직전 최신 spec 참조 (blur 직후 setState 가 클로저에 반영 안 되는 케이스 방어)
  const specRef = useRef(spec);
  specRef.current = spec;
  // 제목 autofill: 사용자가 제목을 직접 건드리기 전까지 이름→제목 연동
  const subjectAuto = useRef(true);
  const lastAutoSubject = useRef(""); // 직전 autofill 결과 — 이것과 다르면 사용자가 손댄 제목
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optStash = useRef<Record<string, any>>({});

  useEscClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    setErr(""); setSel(null); setInsMode("mail"); setAddAt(null); setPreview(false); setDrag(null);
    fetch("/api/templates").then((r) => r.json()).then((j) => setExisting((j.templates ?? []).map((t: any) => ({ name: t.name, archived: t.archived })))).catch(() => {});
    fetch("/api/logos").then((r) => r.json()).then((j) => setLogos(j.logos ?? [])).catch(() => {});
    if (editName) {
      setStarted(true); // 기존 이메일 편집은 시작 화면 없이 바로 편집기로
      subjectAuto.current = false; // 기존 이메일 편집 시 제목 연동 안 함
      setName(editName);
      let cancel = false; // 편집 대상을 빠르게 바꿀 때 늦게 도착한 응답이 현재 세션을 덮어쓰지 않게
      fetch(`/api/templates/spec?name=${encodeURIComponent(editName)}`).then((r) => r.json())
        .then((j) => { if (!cancel) { setSpec(j.spec ?? emptySpec()); setDescription(j.description ?? ""); } })
        .catch(() => { if (!cancel) { setSpec(emptySpec()); setDescription(""); } });
      setUndoBlk(null);
      optStash.current = {};
      return () => { cancel = true; };
    } else { setStarted(false); subjectAuto.current = true; lastAutoSubject.current = ""; setName(""); setDescription(""); setSpec(emptySpec()); }
    setUndoBlk(null);
    optStash.current = {};
  }, [open, editName]);

  /* 시작 화면 → 편집기 진입. 너비 선택을 승계하고 기본 로고는 RLWRLD 로 고정. */
  function defaultLogoSpec(): TemplateSpec["logo"] | undefined {
    const l = logos.find((x) => x.id === "rlwrld") ?? logos[0];
    return l ? { url: l.url, width: l.width, alt: l.label } : undefined;
  }
  function startWith(makeSpec: (() => TemplateSpec) | null) {
    const base = makeSpec ? makeSpec() : emptySpec();
    if (makeSpec) subjectAuto.current = false; // 템플릿 제목 보호
    setSpec({ ...base, width: spec.width, logo: defaultLogoSpec() });
    setStarted(true);
  }

  /* 이름 슬러그 → 제목 자동 변환: "df-seoul-reminder" → "Df Seoul Reminder" */
  function slugToTitle(slug: string): string {
    return slug
      .split(/[-_]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  function onNameChange(v: string) {
    setName(v);
    if (!subjectAuto.current) return;
    setSpec((s) => {
      // 사용자가 입력한 제목(프리셋 포함)은 절대 덮어쓰지 않는다 —
      // 현재 제목이 비어있거나 직전 autofill 결과일 때만 연동.
      if (s.subject && s.subject !== lastAutoSubject.current) {
        subjectAuto.current = false;
        return s;
      }
      const t = slugToTitle(v.trim());
      lastAutoSubject.current = t;
      return { ...s, subject: t };
    });
  }
  /* 제목을 직접 수정하면 이름 연동 해제 (MailInspector 경유). */
  function setDocFromInspector<K extends keyof TemplateSpec>(k: K, v: TemplateSpec[K]) {
    if (k === "subject") subjectAuto.current = false;
    setDoc(k, v);
  }

  /* spec mutators */
  const setDoc = useCallback(<K extends keyof TemplateSpec>(k: K, v: TemplateSpec[K]) => setSpec((s) => ({ ...s, [k]: v })), []);
  const setFooter = useCallback((p: Partial<NonNullable<TemplateSpec["footer"]>>) => setSpec((s) => ({ ...s, footer: { ...s.footer, ...p } })), []);
  const setBlocks = useCallback((fn: (b: Block[]) => Block[]) => setSpec((s) => ({ ...s, blocks: fn(s.blocks) })), []);
  const patchBlock = useCallback((id: string, p: Partial<Block>) => setBlocks((b) => b.map((x) => (x.id === id ? { ...x, ...p } : x))), [setBlocks]);
  const selB = () => spec.blocks.find((b) => b.id === sel) || null;

  function addBlock(type: BlockType, idx: number) {
    const nb = emptyBlock(type);
    setBlocks((b) => { const c = [...b]; c.splice(idx, 0, nb); return c; });
    setAddAt(null); setDrag(null); setSel(nb.id); setInsMode("block");
  }
  function moveBlock(id: string, d: number) {
    setBlocks((b) => { const i = b.findIndex((x) => x.id === id), j = i + d; if (i < 0 || j < 0 || j >= b.length) return b; const c = [...b]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  }
  function delBlock(id: string) {
    // 실수 방지: 삭제 즉시 적용하되 5초간 실행취소 토스트 제공
    const idx = spec.blocks.findIndex((x) => x.id === id);
    const block = spec.blocks[idx];
    setBlocks((b) => b.filter((x) => x.id !== id));
    if (sel === id) { setSel(null); setInsMode("mail"); }
    if (block) {
      setUndoBlk({ block, idx });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndoBlk(null), 5000);
    }
  }
  function undoDelete() {
    if (!undoBlk) return;
    setBlocks((b) => { const c = [...b]; c.splice(Math.min(undoBlk.idx, c.length), 0, undoBlk.block); return c; });
    setUndoBlk(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }
  function setProp(f: keyof Block, v: any) { const b = selB(); if (!b) return; patchBlock(b.id, { [f]: (b as any)[f] === v ? "" : v } as any); }
  // 숫자 캐스팅은 숫자 필드(cols/width)에만 — url 등 텍스트 필드에 "123" 입력 시 number 가 저장돼
  // .trim() 검증이 무음 통과하던 버그 방지.
  const NUMERIC_FIELDS = new Set<keyof Block>(["cols", "width"]);
  function setVal(f: keyof Block, v: any) {
    const b = selB(); if (!b) return;
    const cast = NUMERIC_FIELDS.has(f) && /^\d+$/.test(String(v)) ? Number(v) : v;
    patchBlock(b.id, { [f]: cast } as any);
  }
  function toggleOpt(f: keyof Block) {
    const b = selB(); if (!b) return;
    const cur = (b as any)[f];
    const next = { ...b } as any;
    const key = `${b.id}:${String(f)}`;
    if (cur === undefined) {
      next[f] = optStash.current[key] ?? ""; // 다시 켜면 이전 입력 복원
    } else {
      optStash.current[key] = cur; // 끌 때 값 보존
      delete next[f];
    }
    setBlocks((bs) => bs.map((x) => (x.id === b.id ? next : x)));
  }

  /* array item editors */
  function patchItem(id: string, arr: "items" | "rows" | "cards", i: number, k: string, v: string) {
    setBlocks((b) => b.map((x) => { if (x.id !== id) return x; const a = [...(((x as any)[arr]) || [])]; a[i] = { ...a[i], [k]: v }; return { ...x, [arr]: a }; }));
  }
  function addItem(id: string, arr: "items" | "rows" | "cards", seed: any) {
    setBlocks((b) => b.map((x) => (x.id === id ? { ...x, [arr]: [...(((x as any)[arr]) || []), seed] } : x)));
  }
  function delItem(id: string, arr: "items" | "rows" | "cards", i: number) {
    setBlocks((b) => b.map((x) => (x.id === id ? { ...x, [arr]: ((x as any)[arr] || []).filter((_: any, j: number) => j !== i) } : x)));
  }

  /* image upload (Azure via /api/upload) */
  async function uploadImage(file: File): Promise<string | null> {
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok || !j.url) { setErr(j.error ?? "이미지 업로드 실패"); return null; }
    return j.url;
  }
  function pickImage(cb: (url: string) => void) {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/png,image/jpeg,image/gif,image/webp";
    inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const u = await uploadImage(f); if (u) cb(u); };
    inp.click();
  }

  /* partial-format toolbar */
  const showBar = useCallback((el: HTMLElement) => {
    const s = window.getSelection(); const bar = rtRef.current;
    if (!bar) return;
    if (!s || s.rangeCount === 0 || s.isCollapsed) { bar.style.display = "none"; return; }
    rtTargetId.current = el.getAttribute("data-bid");
    const r = s.getRangeAt(0).getBoundingClientRect();
    bar.style.display = "flex";
    bar.style.top = `${r.top - bar.offsetHeight - 8}px`;
    bar.style.left = `${r.left + r.width / 2 - bar.offsetWidth / 2}px`;
  }, []);
  function applyFmt(cmd: string, val?: string) {
    document.execCommand(cmd, false, val);
    const id = rtTargetId.current; if (!id) return;
    const node = document.querySelector<HTMLElement>(`[data-bid="${id}"][data-rt="1"]`);
    // state 에는 항상 sanitize 결과만 — blur 전에 저장해도 raw HTML 이 들어가지 않게.
    if (node) patchBlock(id, { html: sanitizeInline(node.innerHTML) });
  }
  /* 인라인 링크: 선택이 살아있는 동안(버튼 mousedown preventDefault) 임시 href 앵커를 먼저 만들고,
   * URL 은 state 레벨(블록 html 문자열 치환)로 확정한다 — 입력창 포커스 이동으로 selection/Range 가
   * 무효화되어도 동작하고, sanitizeInline 정규화·DOM 재작성과도 충돌하지 않는다. */
  const PENDING_HREF = "https://pending-link.invalid/edit";
  const [linkInput, setLinkInput] = useState<string | null>(null); // null = 닫힘
  const pendingLinkBlock = useRef<string | null>(null);
  function unwrapPendingInHtml(html: string): string {
    return html.replace(/<a\s[^>]*href="https:\/\/pending-link\.invalid\/edit"[^>]*>([\s\S]*?)<\/a>/gi, "$1");
  }
  function cancelPendingLink() {
    const id = pendingLinkBlock.current;
    pendingLinkBlock.current = null;
    setLinkInput(null);
    if (!id) return;
    setBlocks((bs) => bs.map((x) => (x.id === id && x.html !== undefined ? { ...x, html: unwrapPendingInHtml(x.html) } : x)));
  }
  function openLinkInput() {
    // mousedown preventDefault 로 포커스가 캔버스에 남아 있는 동안 임시 앵커 생성 + 커밋
    applyFmt("createLink", PENDING_HREF);
    pendingLinkBlock.current = rtTargetId.current;
    setLinkInput("https://");
  }
  function applyLink() {
    const url = (linkInput ?? "").trim();
    const id = pendingLinkBlock.current;
    if (!url || !/^(https?:\/\/|mailto:)/i.test(url) || !id) { cancelPendingLink(); return; }
    pendingLinkBlock.current = null;
    setLinkInput(null);
    setBlocks((bs) => bs.map((x) => (x.id === id && x.html !== undefined ? { ...x, html: x.html.split(PENDING_HREF).join(url) } : x)));
    if (rtRef.current) rtRef.current.style.display = "none";
  }
  function removeLink() {
    applyFmt("unlink");
    if (rtRef.current) rtRef.current.style.display = "none";
  }
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const bar = rtRef.current;
      if (bar && !bar.contains(e.target as Node)) {
        bar.style.display = "none";
        if (pendingLinkBlock.current) cancelPendingLink();
        else setLinkInput(null);
      }
    }
    document.addEventListener("mousedown", onDown); return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 편집 중 포커스를 강제로 blur 해 마지막 입력을 커밋시킨다 (저장/미리보기 직전). */
  async function flushEdits() {
    (document.activeElement as HTMLElement | null)?.blur?.();
    await new Promise((r) => setTimeout(r, 0));
  }

  /* preview */
  async function togglePreview() {
    if (preview) { setPreview(false); return; }
    await flushEdits();
    setPreview(true); setSel(null); setPreviewLoading(true);
    try {
      const r = await fetch("/api/templates/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec: specRef.current }) });
      const j = await r.json(); setPreviewHtml(j.html ?? "");
    } catch { setPreviewHtml(""); } finally { setPreviewLoading(false); }
  }

  /* save */
  const trimmed = name.trim();
  const dup = !editName && trimmed ? existing.find((t) => t.name === trimmed) : null;
  const nameInvalid = trimmed && !/^[A-Za-z0-9_-]+$/.test(trimmed);
  const nameError = nameInvalid ? "영문/숫자/하이픈/언더스코어만 사용 가능합니다" : dup ? `이미 같은 이름의 이메일이 있습니다${dup.archived ? " (보관함)" : ""}` : "";
  async function save() {
    setErr("");
    await flushEdits();
    const cur = specRef.current;
    if (nameError) { setErr(nameError); return; }
    if (!trimmed) { setErr("이메일 이름을 입력하세요"); return; }
    if (!cur.subject.trim()) { setErr("이메일 제목을 입력하세요"); return; }
    if (cur.blocks.length === 0) { setErr("블록을 하나 이상 추가하세요"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/templates/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, spec: cur, description, overwrite: !!editName }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "저장 실패");
      onSaved(); onClose();
    } catch (e: any) { setErr(e?.message ?? "저장 실패"); } finally { setSaving(false); }
  }

  useEffect(() => {
    function onBodyClick() { if (addAt !== null && spec.blocks.length > 0) setAddAt(null); }
    document.addEventListener("click", onBodyClick); return () => document.removeEventListener("click", onBodyClick);
  }, [addAt, spec.blocks.length]);

  if (!open) return null;
  const currentLogo = logos.find((l) => l.url === spec.logo?.url) ?? logos.find((l) => l.id === "rlwrld") ?? logos[0];

  return (
    <div className="tcOverlay">
      <div className="tcModal">
        {/* header */}
        <div className="tcHead">
          <button className="tcX" onClick={onClose} title="닫기">✕</button>
          <div className="tcTitle">
            <span className="tcK">{editName ? "이메일 수정" : "새 이메일"}</span>
            <input
              value={name}
              disabled={!!editName}
              className={dup ? "tcNameDup" : undefined}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="이메일 이름 (예: df-seoul-reminder)"
            />
          </div>
          <div className="tcRight">
            {started && (nameError ? <span className={`tcState${dup ? " dup" : ""}`}>{nameError}</span> : !spec.subject.trim() ? <span className="tcState">제목 입력 필요</span> : null)}
            <button className="tcBtn ghost" onClick={() => setHelp(true)} title="도움말" style={{ width: 34, height: 34, padding: 0, justifyContent: "center", borderRadius: "50%", fontWeight: 800 }}>?</button>
            {started && <button className={`tcBtn ghost${preview ? " on" : ""}`} onClick={togglePreview}><Icon n={preview ? "edit" : "eye"} />{preview ? "편집으로" : "미리보기"}</button>}
            {started && <button className="tcBtn primary" onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button>}
          </div>
        </div>
        {err && <div className="tcErr">{err}</div>}

        {!started ? (
          /* ── 시작 화면: 폼 너비 + 템플릿(목표·미리보기) 선택 ── */
          <div className="tcStart">
            <div className="tcStartTop">
              <div>
                <h3>어떤 메일을 만들까요?</h3>
                <p>템플릿을 고르면 바로 편집기로 이동합니다 — 모든 내용은 자유롭게 수정할 수 있어요.</p>
              </div>
              <div className="tcStartWidth">
                <span>폼 너비</span>
                <div className="tcTrack" style={{ width: 230 }}>
                  <button className={(spec.width ?? "default") === "default" ? "on" : ""} onClick={() => setDoc("width", "default")}>기본 600px</button>
                  <button className={spec.width === "wide" ? "on" : ""} onClick={() => setDoc("width", "wide")}>넓게 680px</button>
                </div>
              </div>
            </div>
            <div className="tcStartGrid">
              {PRESETS.map((p) => (
                <button key={p.id} className="tcStartCard" onClick={() => startWith(p.make)}>
                  <div className="tcStartPrev"><MiniPreview make={p.make} width={spec.width} /></div>
                  <div className="tcStartMeta">
                    <b>{p.t}</b>
                    <span className="g">{p.goal}</span>
                    <span className="d">{p.d}</span>
                  </div>
                </button>
              ))}
              <button className="tcStartCard" onClick={() => startWith(null)}>
                <div className="tcStartPrev tcStartBlank">＋</div>
                <div className="tcStartMeta">
                  <b>블랭크로 시작</b>
                  <span className="g">빈 캔버스에서 블록을 직접 조립</span>
                  <span className="d">자유 구성</span>
                </div>
              </button>
            </div>
          </div>
        ) : (
        <div className={`tcWs${preview ? " preview" : ""}`}>
          {/* palette */}
          <aside className="tcPaneL">
            <div className="tcPGroup"><h3>블록 추가</h3>
              {BLOCK_PALETTE.map((p) => (
                <button key={p.type} className="tcPal" draggable
                  onDragStart={(e) => { setDrag(p.type); e.dataTransfer.effectAllowed = "copy"; document.body.classList.add("tcDragging"); }}
                  onDragEnd={() => { document.body.classList.remove("tcDragging"); setTimeout(() => setDrag(null), 60); }}
                  onClick={() => addBlock(p.type, spec.blocks.length)}>
                  <span className="tcIc"><Icon n={p.type} /></span>{p.label}
                </button>
              ))}
              <p className="tcPHint">메일 안으로 <b>드래그</b>하거나 클릭해 맨 끝에 추가.</p>
            </div>
            <div className="tcPGroup"><h3>템플릿</h3>
              {PRESETS.map((p) => (
                <button key={p.id} className="tcPreset" onClick={() => {
                  // 작성 중인 블록이 있으면 통째로 교체되므로 확인
                  if (spec.blocks.length > 0 && !window.confirm("작성 중인 내용을 이 템플릿으로 교체할까요?")) return;
                  subjectAuto.current = false; // 프리셋 제목 보호 — 이름 입력이 덮어쓰지 않게
                  setSpec(p.make()); setSel(null); setInsMode("mail"); setAddAt(null);
                }}><b>{p.t}</b></button>
              ))}
            </div>
          </aside>

          {/* canvas */}
          <main className="tcPaneC">
            <div className="tcInbox" style={{ maxWidth: specWidthPx(spec) }}>
              <div className="tcAv">R</div>
              <div style={{ minWidth: 0 }}>
                <div className="tcIbS">{spec.subject || "(제목 없음)"}</div>
                <div className="tcIbP">{spec.preheader || firstText(spec.blocks) || "(프리헤더)"}</div>
              </div>
              <div style={{ marginLeft: "auto", fontSize: 10, color: "#bbb" }}>오후 3:14</div>
            </div>

            {preview ? (
              <div className="tcSheetWrap" style={{ maxWidth: specWidthPx(spec) }}>
                {previewLoading ? <div className="tcLoading">미리보기 생성 중…</div>
                  : <iframe title="preview" srcDoc={previewHtml} sandbox="allow-same-origin" className="tcIframe" />}
              </div>
            ) : (
              <div className="tcSheet" style={{ maxWidth: specWidthPx(spec) }}>
                {spec.showLogo && (
                  <div className="tcLogo" onClick={(e) => { e.stopPropagation(); setSel(null); setInsMode("mail"); }}>
                    <img src={currentLogo?.url || brand.email.headerLogo.url} alt="logo" />
                    {spec.tagline?.trim() && <div className="tcTag">{spec.tagline}</div>}
                  </div>
                )}
                {spec.blocks.length === 0 && addAt === null ? (
                  <div className="tcEmpty">
                    <div className="tcEB">새 메일 만들기</div>
                    <div className="tcES">왼쪽 팔레트에서 블록을 끌어다 놓거나, 아래 템플릿으로 시작하세요.</div>
                    <div className="tcPGrid">{PRESETS.map((p) => <div key={p.id} className="tcPCard" onClick={() => { subjectAuto.current = false; setSpec(p.make()); }}><div className="t">{p.t}</div><div className="d">{p.d}</div></div>)}</div>
                  </div>
                ) : (
                  <div style={{ padding: "6px 0 0" }}>
                    <Adder idx={0} addAt={addAt} drag={drag} setAddAt={setAddAt} addBlock={addBlock} />
                    {spec.blocks.map((b, idx) => (
                      <div key={b.id}>
                        <div className={`tcBlk${sel === b.id ? " sel" : ""}`} style={{ padding: `${GAP_PX[b.gap ?? ""] ?? 16}px 40px` }}
                          onClick={(e) => { e.stopPropagation(); setSel(b.id); setInsMode("block"); }}>
                          <span className="tcBTag">{TLAB[b.type]}</span>
                          <div className="tcTools">
                            <button title="위로" onClick={(e) => { e.stopPropagation(); moveBlock(b.id, -1); }}><Icon n="up" /></button>
                            <button title="아래로" onClick={(e) => { e.stopPropagation(); moveBlock(b.id, 1); }}><Icon n="down" /></button>
                            <button title="삭제" onClick={(e) => { e.stopPropagation(); delBlock(b.id); }}><Icon n="trash" /></button>
                          </div>
                          <BlockView b={b} idx={idx} patchBlock={patchBlock} patchItem={patchItem} addItem={addItem} delItem={delItem} pickImage={pickImage} showBar={showBar} />
                        </div>
                        <Adder idx={idx + 1} addAt={addAt} drag={drag} setAddAt={setAddAt} addBlock={addBlock} />
                      </div>
                    ))}
                  </div>
                )}
                {spec.showFooter && (
                  <div className="tcFooter" onClick={(e) => { e.stopPropagation(); setSel(null); setInsMode("mail"); }}>
                    {spec.footer?.showSocial !== false && <div className="tcSoc">𝕏 in ▶</div>}
                    <div className="tcFRow">{spec.footer?.orgName?.trim() || brand.identity.legalName}{spec.footer?.showInquiry !== false && <> · 문의: {spec.footer?.inquiryEmail?.trim() || brand.email.defaultInquiry}</>}</div>
                    {spec.footer?.showUnsubscribe !== false && <div className="tcFRow">이 메일을 더 받고 싶지 않으면 <u>수신거부</u></div>}
                    <div className="tcFRow" style={{ color: "#bbb", marginTop: 6 }}>© 2026 {brand.identity.legalName}</div>
                  </div>
                )}
              </div>
            )}
          </main>

          {/* inspector */}
          <aside className="tcPaneR">
            <div className="tcInsTabs"><div className="tcPill">
              <button className={insMode === "block" ? "on" : ""} onClick={() => setInsMode("block")}>선택 블록</button>
              <button className={insMode === "mail" ? "on" : ""} onClick={() => { setSel(null); setInsMode("mail"); }}>세팅</button>
            </div></div>
            {insMode === "block" ? <BlockInspector b={selB()} setProp={setProp} setVal={setVal} toggleOpt={toggleOpt} /> :
              <MailInspector spec={spec} setDoc={setDocFromInspector} setFooter={setFooter} description={description} setDescription={setDescription}
                logos={logos} currentLogo={currentLogo} onLogo={(l: Logo) => setDoc("logo", { url: l.url, width: l.width, alt: l.label })}
                onLogoUpload={() => pickImage((u) => setDoc("logo", { url: u, width: 130, alt: "logo" }))} />}
          </aside>
        </div>
        )}
      </div>

      {/* partial-format toolbar */}
      <div className="tcRtbar" ref={rtRef}>
        {linkInput === null ? (
          <>
            <button onMouseDown={(e) => { e.preventDefault(); applyFmt("bold"); }} style={{ fontWeight: 800 }}>B</button>
            <span className="tcDiv" />
            {BRAND_SW.map((s) => <span key={s.k} className="tcRtsw" style={{ background: s.v }} title={s.n} onMouseDown={(e) => { e.preventDefault(); applyFmt("foreColor", s.v); }} />)}
            <span className="tcDiv" />
            <button title="선택 영역에 링크" onMouseDown={(e) => { e.preventDefault(); openLinkInput(); }} style={{ width: "auto", padding: "0 8px", fontSize: 11.5 }}>🔗 링크</button>
            <button title="링크 제거" onMouseDown={(e) => { e.preventDefault(); removeLink(); }} style={{ width: "auto", padding: "0 8px", fontSize: 11.5 }}>해제</button>
          </>
        ) : (
          <>
            <input
              autoFocus
              className="tcRtUrl"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); applyLink(); }
                // ESC 는 링크 입력만 닫는다 — 컴포저 전체(useEscClose)로 전파 금지
                if (e.key === "Escape") { e.stopPropagation(); cancelPendingLink(); }
              }}
              placeholder="https://… 또는 mailto:"
            />
            <button onMouseDown={(e) => { e.preventDefault(); applyLink(); }} style={{ width: "auto", padding: "0 10px", fontSize: 11.5 }}>적용</button>
            <button onMouseDown={(e) => { e.preventDefault(); cancelPendingLink(); }} style={{ width: "auto", padding: "0 8px", fontSize: 11.5 }}>✕</button>
          </>
        )}
      </div>

      {/* 블록 삭제 실행취소 토스트 */}
      {undoBlk && (
        <div className="tcUndo">
          <span>{TLAB[undoBlk.block.type]} 블록 삭제됨</span>
          <button onClick={undoDelete}>실행취소</button>
        </div>
      )}

      {/* help */}
      {help && (
        <div className="tcHelp" onClick={(e) => { if (e.target === e.currentTarget) setHelp(false); }}>
          <div className="tcHelpCard">
            <div className="tcHelpHead"><b>도움말</b><button onClick={() => setHelp(false)}>✕</button></div>
            <div className="tcHelpBody">
              <h5>개인화 변수 · 본문에 입력</h5>
              <ul>
                <li><code>{"{{name}}"}</code> — 수신자 이름 (이름 없으면 빈칸)</li>
                <li><code>{"{{firstName}}"}</code> — 이름의 첫 단어 (예: Jane Doe → Jane)</li>
                <li><code>{"{{name|친구}}"}</code> — 이름이 없으면 “친구”로 대체</li>
                <li><code>{"{{email}}"}</code> — 수신자 이메일</li>
              </ul>
              <h5>본문 서식</h5><ul><li>텍스트를 <b>드래그</b> → 그 부분만 <b>굵게·색·링크</b> 적용</li></ul>
              <h5>블록 구성</h5><ul><li>제목·버튼·배지·목록·이미지에 <b>코멘트 슬롯</b>을 켜고 끌 수 있음 (인스펙터 → 구성)</li></ul>
              <h5>스타일 값</h5><ul><li><b>빈 값 = 자동</b> — 블록 위치에 따라 정렬·크기가 정해짐</li><li>자유 px·컬러피커는 <b>비활성</b> — 토큰만 제공</li><li>아래 간격: 붙임 / 좁게 / 보통 / 넓게</li></ul>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{CSS}</style>
    </div>
  );
}

function firstText(blocks: Block[]): string {
  const b = blocks.find((x) => x.type === "heading" && x.text) || blocks.find((x) => x.type === "text" && x.html);
  return b ? (b.text || (b.html || "").replace(/<[^>]+>/g, "")) : "";
}

/* ── 시작 화면 템플릿 미리보기 — 실제 렌더러(renderTemplate)를 축소해 그대로 보여준다 ── */
function MiniPreview({ make, width }: { make: () => TemplateSpec; width?: TemplateSpec["width"] }) {
  const W = width === "wide" ? 680 : 600;
  const srcDoc = (() => {
    const html = renderTemplate({ ...make(), width });
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden">${html}</body></html>`;
  })();
  const scale = 300 / (W + 32);
  return (
    <iframe
      title="template-mini-preview"
      tabIndex={-1}
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      style={{ width: W + 32, height: 1200, transform: `scale(${scale})`, transformOrigin: "top left", border: 0, pointerEvents: "none", display: "block" }}
    />
  );
}

/* ── Adder (inline + / dropzone) ──
 * 드래그 핸들러는 컨테이너에 둔다 — "여기에 놓기" 오버레이(::after)나 자식 위로 커서가 가도
 * dragLeave 가 발생하지 않아 깜박임·드롭 무효가 생기지 않는다.
 * (dragleave 는 자식으로 이동할 때도 발생하므로 relatedTarget 으로 진짜 이탈만 처리.) */
function Adder({ idx, addAt, drag, setAddAt, addBlock }: { idx: number; addAt: number | null; drag: BlockType | null; setAddAt: (n: number | null) => void; addBlock: (t: BlockType, i: number) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`tcAdder${over ? " dragover" : ""}`}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return; // 자식/오버레이로의 이동은 이탈 아님
        setOver(false);
      }}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (drag) addBlock(drag, idx); }}
    >
      <button className="tcPlus" onClick={(e) => { e.stopPropagation(); setAddAt(addAt === idx ? null : idx); }}>＋</button>
      {addAt === idx && (
        <div className="tcAddMenu" onClick={(e) => e.stopPropagation()}>
          {BLOCK_PALETTE.map((p) => <button key={p.type} onClick={() => addBlock(p.type, idx)}><Icon n={p.type} /> {p.label}</button>)}
        </div>
      )}
      {/* 드래그 중에만 활성화되는 확장 히트존 — 위아래 블록 가장자리까지 드롭 가능 영역을 넓힌다 */}
      <div className="tcDropHit" />
    </div>
  );
}

/* ── BlockView (canvas) ── */
function BlockView({ b, idx, patchBlock, patchItem, addItem, delItem, pickImage, showBar }: {
  b: Block; idx: number; patchBlock: (id: string, p: Partial<Block>) => void;
  patchItem: (id: string, arr: any, i: number, k: string, v: string) => void;
  addItem: (id: string, arr: any, seed: any) => void; delItem: (id: string, arr: any, i: number) => void;
  pickImage: (cb: (u: string) => void) => void; showBar: (el: HTMLElement) => void;
}) {
  const s = resolveStyle(b, idx);
  const ta = { textAlign: s.align as any };
  const note = (f: keyof Block, ph: string, mt = 8, mb = 0) =>
    <Editable value={(b as any)[f] ?? ""} onCommit={(v) => patchBlock(b.id, { [f]: v } as any)} ph={ph} style={{ ...ta, color: C.muted, fontSize: 12.5, lineHeight: 1.6, margin: `${mt}px 0 ${mb}px` }} />;

  switch (b.type) {
    case "kicker": return <Editable value={b.text ?? ""} onCommit={(v) => patchBlock(b.id, { text: v })} ph="작은 라벨" style={{ ...ta, color: s.color, fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", margin: 0 }} />;
    case "heading": return <>
      <Editable value={b.text ?? ""} onCommit={(v) => patchBlock(b.id, { text: v })} ph="제목 입력" style={{ ...ta, color: s.color, fontSize: SIZEPX[s.size].heading, fontWeight: s.weight === "bold" ? 800 : 700, lineHeight: 1.2, margin: 0, fontFamily: s.font }} />
      {b.subnote !== undefined && note("subnote", "작은 코멘트")}
    </>;
    case "text": return <Editable html={b.html ?? ""} onCommit={(v) => patchBlock(b.id, { html: sanitizeInline(v) })} ph="본문 입력 — 드래그하면 굵게·색 변경 ({{name}} 가능)"
      style={{ ...ta, color: s.color, fontSize: SIZEPX[s.size].text, lineHeight: 1.8, fontWeight: s.weight === "bold" ? 700 : 400, margin: 0, fontFamily: s.font }}
      onSelect={(el) => { el.setAttribute("data-bid", b.id); el.setAttribute("data-rt", "1"); showBar(el); }} />;
    case "badge": return <>
      <table role="presentation" cellPadding={0} cellSpacing={0} style={{ margin: `0 ${s.align === "center" ? "auto" : "0"}` }}><tbody><tr><td style={{ background: "#eef7f5", border: "1px solid #d6ebe8", borderRadius: 6, padding: "13px 20px" }}>
        <Editable value={b.line1 ?? ""} onCommit={(v) => patchBlock(b.id, { line1: v })} ph="1줄" style={{ color: C.ink, fontSize: 15, fontWeight: 600 }} />
        <Editable value={b.line2 ?? ""} onCommit={(v) => patchBlock(b.id, { line2: v })} ph="2줄(선택)" style={{ color: C.sub, fontSize: 13, marginTop: 3 }} />
      </td></tr></tbody></table>
      {b.bottomNote !== undefined && note("bottomNote", "코멘트", 10)}
    </>;
    case "button": {
      const bc = resolveButtonColors(b);
      return <>
        {b.topNote !== undefined && note("topNote", "코멘트", 0, 10)}
        <table role="presentation" cellPadding={0} cellSpacing={0} style={{ margin: `0 ${s.align === "center" ? "auto" : "0"}` }}><tbody><tr><td style={{ background: bc.bg, borderRadius: 8, padding: "13px 34px" }}>
          <Editable value={b.label ?? ""} onCommit={(v) => patchBlock(b.id, { label: v })} ph="버튼 글자" style={{ color: bc.fg, fontWeight: 700, fontSize: 14.5, display: "inline" }} />
          {b.arrow !== false && <span style={{ color: bc.fg, fontWeight: 700 }}> →</span>}
        </td></tr></tbody></table>
        {b.bottomNote !== undefined && note("bottomNote", "코멘트", 10)}
      </>;
    }
    case "numbered": return <ListEditor b={b} s={s} arr="items" patchBlock={patchBlock} patchItem={patchItem} addItem={addItem} delItem={delItem} note={note} />;
    case "agenda": return <ListEditor b={b} s={s} arr="rows" patchBlock={patchBlock} patchItem={patchItem} addItem={addItem} delItem={delItem} note={note} />;
    case "grid": return <GridEditor b={b} patchBlock={patchBlock} patchItem={patchItem} addItem={addItem} delItem={delItem} pickImage={pickImage} />;
    case "image": return <>
      {b.title !== undefined && <Editable value={b.title ?? ""} onCommit={(v) => patchBlock(b.id, { title: v })} ph="상단 제목" style={{ ...ta, color: C.ink, fontSize: 16, fontWeight: 700, margin: "0 0 10px" }} />}
      {b.url ? <div style={{ position: "relative" }}>
        <img src={b.url} alt={b.alt ?? ""} style={{ maxWidth: "100%", borderRadius: 8, display: "block", margin: "0 auto" }} />
        {b.href?.trim() && <span className="tcImgLink editonly" title={`클릭 시 이동: ${b.href}`}>🔗 링크 연결됨</span>}
      </div>
        : <div className="tcImgdrop editonly" style={{ padding: 34 }} onClick={(e) => { e.stopPropagation(); pickImage((u) => patchBlock(b.id, { url: u })); }}>＋ 이미지 업로드</div>}
      {b.url && <input
        className="editonly"
        value={b.alt ?? ""}
        onChange={(e) => patchBlock(b.id, { alt: e.target.value })}
        onClick={(e) => e.stopPropagation()}
        placeholder="대체텍스트(alt) — 이미지 안 보일 때·스크린리더·스팸필터 대비"
        style={{ marginTop: 9, width: "100%", fontSize: 11, padding: "5px 8px", border: "1px solid #e3e5e8", borderRadius: 6, outline: "none", background: "#fff", color: "#2a3034" }}
      />}
      {b.caption !== undefined && note("caption", "코멘트", 10)}
    </>;
    case "divider": return <div style={{ borderTop: `1px solid ${C.muted}22`, margin: 0 }} />;
    default: return null;
  }
}

function ListEditor({ b, s, arr, patchBlock, patchItem, addItem, delItem, note }: any) {
  const ta = { textAlign: s.align };
  const isNum = arr === "items";
  const rows = (b as any)[arr] || [];
  return <>
    {b.title !== undefined && <Editable value={b.title ?? ""} onCommit={(v: string) => patchBlock(b.id, { title: v })} ph="제목" style={{ ...ta, color: C.ink, fontSize: 18, fontWeight: 700, margin: `0 0 ${b.titleNote !== undefined ? 4 : 14}px` }} />}
    {b.titleNote !== undefined && note("titleNote", "코멘트", 0, 14)}
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}><tbody>
      {rows.map((it: any, i: number) => (
        <tr key={i}>
          {isNum ? <td valign="top" width={28} style={{ color: C.teal, fontFamily: MONO, fontSize: 13, fontWeight: 600, paddingTop: 2 }}>{String(i + 1).padStart(2, "0")}</td>
            : <td width={92} valign="top" style={{ padding: "4px 14px 4px 0" }}><Editable value={it.time ?? ""} onCommit={(v: string) => patchItem(b.id, arr, i, "time", v)} ph="시간" style={{ color: C.sub, fontFamily: MONO, fontSize: 13, whiteSpace: "nowrap" }} /></td>}
          <td style={{ paddingBottom: isNum ? 12 : 0, padding: isNum ? "0 0 12px" : "4px 0" }}>
            {isNum ? <>
              <Editable value={it.title ?? ""} onCommit={(v: string) => patchItem(b.id, arr, i, "title", v)} ph="항목 제목" style={{ color: C.ink, fontWeight: 700, fontSize: 14 }} />
              <Editable value={it.desc ?? ""} onCommit={(v: string) => patchItem(b.id, arr, i, "desc", v)} ph="설명 (선택)" style={{ color: C.sub, fontSize: 13, marginTop: 2 }} />
            </> : <Editable value={it.label ?? ""} onCommit={(v: string) => patchItem(b.id, arr, i, "label", v)} ph="내용" />}
          </td>
          <td valign="top" className="editonly"><button className="tcRowDel" onClick={(e) => { e.stopPropagation(); delItem(b.id, arr, i); }}>✕</button></td>
        </tr>
      ))}
    </tbody></table>
    <div className="tcItemCtl editonly"><button className="tcItemAdd" onClick={(e) => { e.stopPropagation(); addItem(b.id, arr, isNum ? { title: "", desc: "" } : { time: "", label: "" }); }}>＋ {isNum ? "항목" : "행"} 추가</button></div>
    {b.bottomNote !== undefined && note("bottomNote", "코멘트", 14)}
  </>;
}

function GridEditor({ b, patchBlock, patchItem, addItem, delItem, pickImage }: any) {
  const cols = b.cols === 3 ? 3 : 2;
  const t: CardType = b.cardType || "feature";
  const align: Align = b.cardAlign || (t === "stat" ? "center" : "left");
  const cards: GridCard[] = b.cards || [];
  const ed = (i: number, k: string, ph: string, style: React.CSSProperties) =>
    <Editable value={(cards[i] as any)[k] ?? ""} onCommit={(v) => patchItem(b.id, "cards", i, k, v)} ph={ph} style={{ ...style, textAlign: align as any }} />;
  return <>
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ margin: "0 -7px", borderCollapse: "separate", borderSpacing: 0 }}><tbody>
      {Array.from({ length: Math.ceil(cards.length / cols) }).map((_, r) => (
        <tr key={r}>{cards.slice(r * cols, r * cols + cols).map((c, j) => {
          const i = r * cols + j;
          return <td key={i} width={`${Math.floor(100 / cols)}%`} style={{ verticalAlign: "top", padding: 7 }}>
            <div className={`tcGCard${t === "cta" ? " cta" : ""}`}>
              {t === "feature" && <>{ed(i, "title", "제목", { color: C.ink, fontWeight: 700, fontSize: 14.5 })}{ed(i, "desc", "설명", { color: C.sub, fontSize: 12.5, marginTop: 6, lineHeight: 1.6 })}</>}
              {t === "image" && <>{c.img ? <img src={c.img} alt="" style={{ width: "100%", height: 96, objectFit: "cover", borderRadius: 8, display: "block", marginBottom: 11 }} /> : <div className="tcImgdrop editonly" style={{ height: 96, marginBottom: 11 }} onClick={(e) => { e.stopPropagation(); pickImage((u: string) => patchItem(b.id, "cards", i, "img", u)); }}>＋ 이미지</div>}{ed(i, "desc", "설명", { color: C.sub, fontSize: 12.5, lineHeight: 1.6 })}</>}
              {t === "stat" && <>{ed(i, "value", "120+", { color: C.teal, fontWeight: 800, fontSize: 28, fontFamily: MONO, lineHeight: 1.1 })}{ed(i, "title", "라벨", { color: C.sub, fontSize: 12.5, marginTop: 6 })}</>}
              {t === "cta" && <>
                {ed(i, "title", "제목", { color: C.ink, fontWeight: 700, fontSize: 15 })}
                {ed(i, "desc", "설명", { color: C.sub, fontSize: 12.5, marginTop: 6, lineHeight: 1.6 })}
                <div style={{ marginTop: 13, textAlign: align as any }}>
                  <Editable value={(cards[i] as any).btn ?? ""} onCommit={(v) => patchItem(b.id, "cards", i, "btn", v)} ph="자세히" style={{ color: C.teal, fontWeight: 700, fontSize: 13, display: "inline" }} />
                  <span style={{ color: C.teal, fontWeight: 700, fontSize: 13 }}> →</span>
                </div>
                <input
                  className="editonly tcCardUrl"
                  value={(cards[i] as any).url ?? ""}
                  onChange={(e) => patchItem(b.id, "cards", i, "url", e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="링크 URL (https:// 또는 mailto:)"
                  style={{ marginTop: 9, width: "100%", fontSize: 11, padding: "5px 8px", border: "1px solid #e3e5e8", borderRadius: 6, outline: "none", background: "#fff", color: "#2a3034" }}
                />
                {(cards[i] as any).url?.trim() && !/^(https?:\/\/|mailto:)/i.test((cards[i] as any).url.trim()) && (
                  <div className="editonly" style={{ fontSize: 10, color: "#d33", marginTop: 3 }}>⚠ https:// 또는 mailto: 필요</div>
                )}
              </>}
              <button className="tcRowDel editonly" style={{ position: "absolute", top: 6, right: 6 }} onClick={(e) => { e.stopPropagation(); delItem(b.id, "cards", i); }}>✕</button>
            </div>
          </td>;
        })}</tr>
      ))}
    </tbody></table>
    <div className="tcItemCtl editonly"><button className="tcItemAdd" onClick={(e) => { e.stopPropagation(); addItem(b.id, "cards", { title: "", desc: "" }); }}>＋ 카드 추가</button></div>
  </>;
}

/* ── Inspector parts ── */
function Track({ label, field, opts, b, on }: { label: string; field: keyof Block; opts: [string, string][]; b: Block; on: (f: keyof Block, v: string) => void }) {
  return <div className="tcSec"><label>{label}</label><div className="tcTrack">{opts.map(([v, t]) => <button key={v} className={String((b as any)[field] ?? "") === String(v) ? "on" : ""} onClick={() => on(field, v)}>{t}</button>)}</div></div>;
}
function BlockInspector({ b, setProp, setVal, toggleOpt }: { b: Block | null; setProp: (f: keyof Block, v: any) => void; setVal: (f: keyof Block, v: any) => void; toggleOpt: (f: keyof Block) => void }) {
  if (!b) return <div className="tcInsEmpty">메일에서 블록을 클릭하면<br />여기서 구성·스타일을 조정합니다.</div>;
  if (b.type === "grid") return <div className="tcInsBody">
    <div className="tcCrumb">선택: <b>그리드</b></div>
    <div className="tcSecTitle">그리드</div>
    <Track label="열 수" field="cols" opts={[["2", "2열"], ["3", "3열"]]} b={b} on={(f, v) => setVal(f, v)} />
    <Track label="카드 형식" field="cardType" opts={CARD_TYPES as any} b={b} on={(f, v) => setVal(f, v)} />
    <Track label="내용 정렬" field="cardAlign" opts={[["left", "좌"], ["center", "가운데"], ["right", "우"]]} b={b} on={(f, v) => setProp(f, v)} />
    <div className="tcSecTitle" style={{ marginTop: 18 }}>스타일</div>
    <Track label="아래 간격" field="gap" opts={[["tight", "붙임"], ["sm", "좁게"], ["", "보통"], ["lg", "넓게"]]} b={b} on={(f, v) => setProp(f, v)} />
  </div>;
  const comp = COMPOSE[b.type];
  const texty = b.type === "heading" || b.type === "text";
  return <div className="tcInsBody">
    <div className="tcCrumb">선택: <b>{TLAB[b.type]}</b></div>
    {b.type === "button" && (
      <>
        <div className="tcFld" style={{ marginBottom: 4 }}>
          <label>링크 URL <span className="tcReq">*</span></label>
          <input
            value={(b as any).url ?? ""}
            onChange={(e) => setVal("url", e.target.value)}
            placeholder="https://… 또는 mailto:주소"
          />
          {(b as any).url?.trim() && !/^(https?:\/\/|mailto:)/i.test((b as any).url.trim()) && (
            <div style={{ fontSize: 10.5, color: "#d33", marginTop: 4 }}>⚠ https:// 또는 mailto: 로 시작해야 링크가 동작합니다 (아니면 무효 처리)</div>
          )}
        </div>
        <div className="tcSec" style={{ marginTop: 12 }}>
          <label>버튼 색</label>
          <div className="tcSwatches">
            {BTN_SW.map((s) => (
              <div key={s.k} className={`tcSw${(b.btnColor || "mint") === s.k ? " on" : ""}`} title={s.n} style={{ background: s.v }} onClick={() => setVal("btnColor", s.k)} />
            ))}
          </div>
        </div>
        <div className="tcOptRow">화살표 (→)<label className="tcToggle"><input type="checkbox" checked={b.arrow !== false} onChange={(e) => setVal("arrow", e.target.checked)} /><span /></label></div>
      </>
    )}
    {b.type === "image" && (
      <>
        <div className="tcFld" style={{ marginBottom: 4 }}>
          <label>클릭 시 이동 URL (선택)</label>
          <input
            value={(b as any).href ?? ""}
            onChange={(e) => setVal("href", e.target.value)}
            placeholder="https://… 또는 mailto:주소"
          />
          {(b as any).href?.trim() && !/^(https?:\/\/|mailto:)/i.test(String((b as any).href).trim()) && (
            <div style={{ fontSize: 10.5, color: "#d33", marginTop: 4 }}>⚠ https:// 또는 mailto: 로 시작해야 링크가 동작합니다</div>
          )}
        </div>
        <div className="tcFld">
          <label>이미지 너비 (px · 비우면 원본)</label>
          <input
            type="number"
            value={(b as any).width ?? ""}
            onChange={(e) => setVal("width", e.target.value === "" ? undefined : e.target.value)}
            placeholder="예: 320"
          />
        </div>
        <div className="tcOptRow">좌우 여백 제거 (배너용)<label className="tcToggle"><input type="checkbox" checked={!!b.fullBleed} onChange={(e) => setVal("fullBleed", e.target.checked)} /><span /></label></div>
      </>
    )}
    {b.type === "text" ? null : comp ? <>
      <div className="tcSecTitle">구성</div>
      {comp.map(([f, l]: [keyof Block, string]) => <div key={String(f)} className="tcOptRow">{l}<label className="tcToggle"><input type="checkbox" checked={(b as any)[f] !== undefined} onChange={() => toggleOpt(f)} /><span /></label></div>)}
    </> : null}
    <div className="tcSecTitle" style={{ marginTop: 18 }}>스타일</div>
    <Track label="정렬" field="align" opts={[["left", "좌"], ["center", "가운데"], ["right", "우"]]} b={b} on={(f, v) => setProp(f, v)} />
    <Track label="아래 간격" field="gap" opts={[["tight", "붙임"], ["sm", "좁게"], ["", "보통"], ["lg", "넓게"]]} b={b} on={(f, v) => setProp(f, v)} />
    {texty && <Track label="크기" field="size" opts={[["S", "작게"], ["M", "보통"], ["L", "크게"]]} b={b} on={(f, v) => setProp(f, v)} />}
    {b.type === "heading" && <Track label="굵기" field="weight" opts={[["normal", "보통"], ["bold", "굵게"]]} b={b} on={(f, v) => setProp(f, v)} />}
    {texty && <Track label="글꼴" field="font" opts={[["sans", "Sans"], ["mono", "Mono"]]} b={b} on={(f, v) => setProp(f, v)} />}
    {b.type === "heading" && <div className="tcSec"><label>색</label><div className="tcSwatches">{BRAND_SW.map((s) => <div key={s.k} className={`tcSw${b.color === s.k ? " on" : ""}`} title={s.n} style={{ background: s.v }} onClick={() => setProp("color", s.k)} />)}</div></div>}
  </div>;
}
function MailInspector({ spec, setDoc, setFooter, description, setDescription, logos, currentLogo, onLogo, onLogoUpload }: any) {
  const d: TemplateSpec = spec;
  return <div className="tcInsBody">
    {/* ── 메일 설정 ── */}
    <div className="tcBigTitle" style={{ marginTop: 0 }}>메일 설정</div>
    <div className="tcFld"><label>이메일 제목 <span className="tcReq">*</span></label><input value={d.subject} onChange={(e) => setDoc("subject", e.target.value)} placeholder="[알림] 행사 D-1 안내" /></div>
    <div className="tcFld"><label>프리헤더 · 받은편지함 미리보기</label><input value={d.preheader ?? ""} onChange={(e) => setDoc("preheader", e.target.value)} placeholder="짧은 한 줄 요약" /></div>
    <div className="tcFld"><label>설명 (선택)</label><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="용도 메모" /></div>
    <div className="tcSec"><label>본문 너비</label>
      <div className="tcTrack">
        <button className={(d.width ?? "default") === "default" ? "on" : ""} onClick={() => setDoc("width", "default")}>기본 600px</button>
        <button className={d.width === "wide" ? "on" : ""} onClick={() => setDoc("width", "wide")}>넓게 680px</button>
      </div>
      <p style={{ fontSize: 10, color: "#8b9196", margin: "6px 2px 0", lineHeight: 1.5 }}>600px = 이메일 표준. 680px = Gmail·Outlook에서 안전한 와이드 상한 (모바일은 자동 축소).</p>
    </div>

    {/* ── 로고 설정 ── */}
    <div className="tcBigTitle">로고 설정</div>
    <div className="tcOptRow">로고 표시<label className="tcToggle"><input type="checkbox" checked={d.showLogo} onChange={(e) => setDoc("showLogo", e.target.checked)} /><span /></label></div>
    {d.showLogo && <div className="tcSubgroup">
      {logos.length > 0 && <div className="tcFld"><label>로고 선택</label><select value={currentLogo?.id ?? ""} onChange={(e) => { const l = logos.find((x: Logo) => x.id === e.target.value); if (l) onLogo(l); }}>{logos.map((l: Logo) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></div>}
      <button type="button" className="tcMini" onClick={onLogoUpload}>＋ 로고 업로드</button>
      <div className="tcFld" style={{ marginTop: 10, marginBottom: 0 }}><label>로고 아래 문구 (선택)</label><input value={d.tagline ?? ""} onChange={(e) => setDoc("tagline", e.target.value)} placeholder="비우면 표시 안 함" /></div>
    </div>}

    {/* ── 푸터 설정 ── */}
    <div className="tcBigTitle">푸터 설정</div>
    <div className="tcOptRow">푸터 표시<label className="tcToggle"><input type="checkbox" checked={d.showFooter} onChange={(e) => setDoc("showFooter", e.target.checked)} /><span /></label></div>
    {d.showFooter && <div className="tcSubgroup">
      <div className="tcOptRow" style={{ paddingTop: 0 }}>소셜 아이콘<label className="tcToggle"><input type="checkbox" checked={d.footer?.showSocial !== false} onChange={(e) => setFooter({ showSocial: e.target.checked })} /><span /></label></div>
      <div className="tcOptRow">수신거부 링크<label className="tcToggle"><input type="checkbox" checked={d.footer?.showUnsubscribe !== false} onChange={(e) => setFooter({ showUnsubscribe: e.target.checked })} /><span /></label></div>
      <div className="tcOptRow">문의 이메일 표시<label className="tcToggle"><input type="checkbox" checked={d.footer?.showInquiry !== false} onChange={(e) => setFooter({ showInquiry: e.target.checked })} /><span /></label></div>
      <div className="tcFld" style={{ marginTop: 10 }}><label>전송자 명칭</label><input value={d.footer?.orgName ?? ""} onChange={(e) => setFooter({ orgName: e.target.value })} placeholder={brand.identity.legalName} /></div>
      {d.footer?.showInquiry !== false && <div className="tcFld" style={{ marginBottom: 0 }}><label>문의 이메일</label><input value={d.footer?.inquiryEmail ?? ""} onChange={(e) => setFooter({ inquiryEmail: e.target.value })} placeholder={`inquiry@${brand.auth.senderDomain}`} /></div>}
    </div>}
  </div>;
}

/* ── styles ── */
const CSS = `
.tcOverlay{position:fixed;inset:0;z-index:50;background:rgba(12,18,22,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:26px}
.tcModal{width:min(1160px,96vw);height:min(880px,92vh);background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(8,18,24,.45);display:flex;flex-direction:column;color:#1c2226;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.tcHead{height:60px;flex:0 0 auto;display:flex;align-items:center;gap:14px;padding:0 18px;border-bottom:1px solid #ececef}
.tcX{width:34px;height:34px;border-radius:9px;border:1px solid #e3e5e8;background:#fff;cursor:pointer;color:#5a6166;font-size:16px;display:flex;align-items:center;justify-content:center}
.tcX:hover{background:#f6f7f9}
.tcTitle{flex:1;min-width:0;display:flex;flex-direction:column}
.tcTitle .tcK{font-size:9px;letter-spacing:1.6px;text-transform:uppercase;color:#8b9196;font-weight:700}
.tcTitle input{border:0;outline:0;font-size:15.5px;font-weight:700;color:#10161a;padding:1px 0;width:100%;background:transparent}
.tcTitle input::placeholder{color:#bcc2c7;font-weight:600}
.tcRight{display:flex;align-items:center;gap:9px}
.tcState{font-size:11px;color:#aa6a4a}
.tcState.dup{color:#e0564f;font-weight:700}
.tcTitle input.tcNameDup{color:#e0564f;background:#fdecea;border-radius:6px;padding:1px 6px;box-shadow:0 0 0 1.5px #e0564f55}
.tcBtn{border:0;border-radius:10px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.tcBtn.ghost{background:#fff;border:1px solid #e3e5e8;color:#454b50}
.tcBtn.ghost:hover{background:#f6f7f9}
.tcBtn.ghost.on{background:#eaf6f4;color:${C.teal};border-color:#cfe9e4}
.tcBtn.primary{background:${C.teal};color:#fff}
.tcBtn.primary:disabled{opacity:.6;cursor:default}
.tcBtn svg{width:15px;height:15px}
.tcErr{background:#fdecea;color:#c0392b;font-size:12px;padding:8px 18px;border-bottom:1px solid #f5c6c0}
.tcWs{flex:1;display:grid;grid-template-columns:206px 1fr 290px;min-height:0}
.tcWs.preview{grid-template-columns:0 1fr 0}
.tcWs.preview .tcPaneL,.tcWs.preview .tcPaneR{opacity:0;pointer-events:none}
.tcPaneL{border-right:1px solid #ececef;background:#fcfcfd;overflow:auto;padding:16px 12px}
.tcPGroup{margin-bottom:20px}
.tcPGroup h3{margin:0 0 9px 6px;font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:#8b9196;font-weight:700}
.tcPal{display:flex;align-items:center;gap:10px;width:100%;border:0;background:none;border-radius:9px;padding:8px 9px;cursor:grab;font-size:13px;color:#2a3034;text-align:left}
.tcPal:hover{background:#eaf6f4;color:${C.teal}}
.tcPal:active{cursor:grabbing}
.tcIc{width:30px;height:30px;border-radius:8px;background:#fff;border:1px solid #e3e5e8;display:flex;align-items:center;justify-content:center;color:${C.teal};flex:0 0 auto}
.tcIc svg{width:16px;height:16px}
.tcPHint{font-size:10.5px;color:#8b9196;line-height:1.5;margin:8px 6px 0}
.tcPreset{display:flex;align-items:center;gap:9px;width:100%;border:1px solid #ececef;background:#fff;border-radius:10px;padding:9px 11px;margin-bottom:7px;cursor:pointer;font-size:12.5px;text-align:left;color:#2a3034}
.tcPreset:hover{border-color:#cfe9e4;background:#eaf6f4}
.tcPaneC{overflow:auto;background:#f1f3f4;padding:26px 20px 70px}
.tcInbox{max-width:600px;margin:0 auto 16px;background:#fff;border:1px solid #ececef;border-radius:12px;padding:10px 13px;display:flex;gap:10px;align-items:flex-start;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.tcAv{width:30px;height:30px;border-radius:50%;background:#eaf6f4;color:${C.teal};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex:0 0 auto}
.tcIbS{font-size:12.5px;font-weight:600;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tcIbP{font-size:11px;color:#9aa6ab;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tcSheet{max-width:600px;margin:0 auto;background:#fff;border:1px solid #e4e4e4;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(15,30,35,.09)}
.tcSheetWrap{max-width:600px;margin:0 auto}
.tcIframe{width:100%;height:70vh;border:1px solid #e4e4e4;border-radius:12px;background:#fff}
.tcLoading{padding:60px;text-align:center;color:#8b9196;font-size:13px}
.tcLogo{position:relative;text-align:center;padding:34px 0 26px;cursor:pointer}
.tcLogo:hover{background:#fbfdfd}
.tcLogo img{height:26px;margin:0 auto}
.tcTag{font-size:11.5px;color:#888;margin-top:7px}
.tcFooter{padding:30px 40px 36px;border-top:1px solid #f1f1f1;text-align:center;cursor:pointer}
.tcFooter:hover{background:#fbfdfd}
.tcFRow{font-size:11px;color:#888;line-height:1.7}
.tcSoc{margin-bottom:10px;letter-spacing:7px;color:#d2d2d2;font-size:13px}
.tcEmpty{padding:36px 34px 48px;text-align:center}
.tcEB{font-size:17px;font-weight:700;margin-bottom:6px}
.tcES{font-size:12.5px;color:#888;margin-bottom:22px;line-height:1.6}
.tcPGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;text-align:left}
.tcPCard{border:1px solid #ececef;border-radius:13px;padding:14px;cursor:pointer;background:#f6f7f9}
.tcPCard:hover{border-color:#cfe9e4;background:#eaf6f4}
.tcPCard .t{font-weight:700;font-size:13px}
.tcPCard .d{font-size:11px;color:#888;margin-top:3px;line-height:1.5}
.tcBlk{position:relative;outline:0;transition:background .1s}
.tcBlk:hover{background:#f6fcfb}
.tcBlk.sel{background:#eaf6f4;box-shadow:inset 0 0 0 2px ${C.teal}}
.tcBTag{position:absolute;top:0;left:0;background:${C.teal};color:#fff;font-size:9px;font-weight:700;padding:2px 8px;border-radius:0 0 8px 0;letter-spacing:.5px;display:none;text-transform:uppercase}
.tcBlk.sel .tcBTag{display:block}
.tcTools{position:absolute;top:6px;right:8px;display:none;gap:4px;z-index:4}
.tcBlk:hover .tcTools{display:flex}
.tcTools button{width:26px;height:26px;border:1px solid #e3e5e8;background:#fff;border-radius:7px;cursor:pointer;color:#5a6166;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.07)}
.tcTools button:hover{border-color:#cfe9e4;color:${C.teal}}
.tcTools svg{width:14px;height:14px}
.tcModal [contenteditable]{outline:0}
.tcModal [contenteditable]:empty:before{content:attr(data-ph);color:#c7c7c7}
.tcGCard{border:1.5px solid #dadee1;box-shadow:0 3px 12px rgba(20,30,35,.09);border-radius:13px;padding:16px;height:100%;position:relative;background:#fff;transition:box-shadow .14s,border-color .14s,transform .14s}
.tcGCard:hover{box-shadow:0 6px 18px rgba(20,30,35,.13);border-color:#c6ccd0}
.tcGCard.cta{cursor:pointer}
.tcGCard.cta:hover{transform:translateY(-3px);border-color:${C.teal};box-shadow:0 10px 24px rgba(13,138,126,.18)}
.tcImgdrop{border-radius:8px;background:#f0f2f3;border:1.5px dashed #cfd4d7;display:flex;align-items:center;justify-content:center;color:#9aa1a6;font-size:12px;cursor:pointer}
.tcImgdrop:hover{border-color:${C.teal};color:${C.teal};background:#eaf6f4}
.tcItemCtl{margin-top:8px}
.tcItemAdd{border:1px dashed #cfe9e4;background:#fff;color:${C.teal};border-radius:7px;padding:5px 11px;font-size:11.5px;cursor:pointer}
.tcItemAdd:hover{background:#eaf6f4}
.tcRowDel{border:0;background:none;color:#c4c8cb;cursor:pointer;font-size:13px;padding:2px 5px}
.tcRowDel:hover{color:#e0564f}
.tcWs.preview .tcTools,.tcWs.preview .editonly{display:none!important}
.tcAdder{position:relative;display:flex;align-items:center;justify-content:center;min-height:16px;transition:min-height .1s}
body.tcDragging .tcAdder{min-height:30px}
.tcPlus{border:0;background:${C.teal};color:#fff;width:25px;height:25px;border-radius:50%;cursor:pointer;font-size:15px;line-height:1;opacity:0;transition:opacity .12s;z-index:3;box-shadow:0 2px 6px rgba(13,138,126,.4)}
.tcAdder:hover .tcPlus{opacity:1}
/* 드롭 히트존: 드래그 중에만 활성화 — 평소엔 클릭을 가로채지 않고,
   드래그 중엔 위아래 블록 가장자리(±16px)까지 넉넉히 잡는다. */
.tcDropHit{display:none}
body.tcDragging .tcDropHit{display:block;position:absolute;inset:-16px 0;z-index:1}
/* 하이라이트 시 높이 고정(30px 유지) — 레이아웃 점프로 커서 아래 영역이 움직이며 깜박이는 것 방지 */
.tcAdder.dragover:after{content:"여기에 놓기";position:absolute;left:34px;right:34px;height:28px;border:2px dashed ${C.teal};border-radius:9px;background:#eaf6f4;color:${C.teal};font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;z-index:2;pointer-events:none}
.tcAddMenu{position:absolute;top:30px;background:#fff;border:1px solid #ececef;border-radius:13px;box-shadow:0 14px 36px rgba(0,0,0,.17);padding:7px;z-index:20;display:grid;grid-template-columns:1fr 1fr;gap:4px;width:276px}
.tcAddMenu button{display:flex;align-items:center;gap:8px;border:0;background:none;border-radius:8px;padding:8px 9px;cursor:pointer;font-size:12.5px;text-align:left;color:#333}
.tcAddMenu button:hover{background:#eaf6f4;color:${C.teal}}
.tcAddMenu button svg{width:15px;height:15px;color:${C.teal}}
.tcRtbar{position:fixed;display:none;gap:5px;background:#11181b;border-radius:10px;padding:6px;z-index:60;box-shadow:0 8px 24px rgba(0,0,0,.35);align-items:center}
.tcRtbar button{width:28px;height:28px;border:0;border-radius:7px;background:#26343a;color:#fff;cursor:pointer;font-size:13px}
.tcRtbar button:hover{background:#33454c}
.tcRtbar .tcDiv{width:1px;height:20px;background:#33454c}
.tcRtsw{width:20px;height:20px;border-radius:50%;cursor:pointer;border:2px solid #11181b;box-shadow:0 0 0 1px #33454c}
.tcRtsw:hover{transform:scale(1.12)}
.tcRtUrl{width:220px;height:28px;border:0;border-radius:7px;background:#26343a;color:#fff;font-size:12px;padding:0 10px;outline:0}
.tcRtUrl::placeholder{color:#7d8d94}
.tcUndo{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);z-index:70;background:#11181b;color:#fff;border-radius:11px;padding:10px 14px;display:flex;align-items:center;gap:12px;font-size:12.5px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.tcUndo button{border:0;background:none;color:${C.mint};font-weight:700;font-size:12.5px;cursor:pointer}
.tcUndo button:hover{text-decoration:underline}
.tcImgLink{position:absolute;top:8px;left:8px;background:rgba(17,24,27,.78);color:#fff;font-size:10px;font-weight:600;padding:3px 8px;border-radius:6px}
.tcPaneR{border-left:1px solid #ececef;background:#fff;overflow:auto}
.tcInsTabs{position:sticky;top:0;background:#fff;z-index:2;padding:14px 16px 0}
.tcPill{display:flex;background:#f6f7f9;border-radius:11px;padding:4px;gap:4px}
.tcPill button{flex:1;border:0;background:none;border-radius:8px;padding:8px;font-size:12px;font-weight:600;color:#8b9196;cursor:pointer}
.tcPill button.on{background:#fff;color:${C.teal};box-shadow:0 1px 3px rgba(0,0,0,.08)}
.tcInsBody{padding:16px}
.tcCrumb{font-size:11px;color:#8b9196;margin-bottom:14px;line-height:1.5}
.tcCrumb b{color:${C.teal}}
.tcBigTitle{font-size:14px;font-weight:800;color:#10161a;letter-spacing:-0.2px;margin:26px 0 14px;padding-bottom:9px;border-bottom:2px solid #e3e5e8}
.tcStart{flex:1;min-height:0;overflow:auto;background:#f1f3f4;padding:30px 36px}
.tcStartTop{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:22px}
.tcStartTop h3{margin:0;font-size:20px;font-weight:800;letter-spacing:-0.4px}
.tcStartTop p{margin:6px 0 0;font-size:12.5px;color:#7b8388}
.tcStartWidth{display:flex;align-items:center;gap:10px}
.tcStartWidth>span{font-size:11px;font-weight:700;color:#5a6166;text-transform:uppercase;letter-spacing:.6px}
.tcStartWidth .tcTrack{background:#fff;border:1px solid #e3e5e8}
.tcStartGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.tcStartCard{border:1px solid #e3e5e8;background:#fff;border-radius:16px;overflow:hidden;cursor:pointer;text-align:left;padding:0;transition:transform .15s,box-shadow .15s,border-color .15s;display:flex;flex-direction:column}
.tcStartCard:hover{transform:translateY(-3px);border-color:${C.teal};box-shadow:0 14px 34px rgba(13,138,126,.16)}
.tcStartPrev{height:175px;overflow:hidden;background:#f5f5f5;border-bottom:1px solid #ececef;position:relative}
.tcStartPrev:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 70%,rgba(245,245,245,.95))}
.tcStartBlank{display:flex;align-items:center;justify-content:center;font-size:38px;color:${C.teal};background:#eaf6f4}
.tcStartBlank:after{display:none}
.tcStartMeta{padding:13px 15px 14px;display:flex;flex-direction:column;gap:3px}
.tcStartMeta b{font-size:14px;font-weight:800;color:#10161a}
.tcStartMeta .g{font-size:11.5px;color:${C.teal};font-weight:600}
.tcStartMeta .d{font-size:10.5px;color:#9aa1a6}
.tcSecTitle{font-size:11px;font-weight:700;color:#3a4044;margin:4px 0 10px;display:flex;align-items:center;gap:7px}
.tcSecTitle:after{content:"";flex:1;height:1px;background:#ececef}
.tcSec{margin-bottom:16px}
.tcSec>label{display:block;font-size:10.5px;color:#8b9196;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;font-weight:700}
.tcTrack{display:flex;background:#f6f7f9;border-radius:10px;padding:4px;gap:3px}
.tcTrack button{flex:1;border:0;background:none;border-radius:7px;padding:8px 4px;cursor:pointer;font-size:12px;color:#4a5054;font-weight:500}
.tcTrack button:hover{color:${C.teal}}
.tcTrack button.on{background:#fff;color:${C.teal};box-shadow:0 1px 3px rgba(0,0,0,.09);font-weight:700}
.tcSwatches{display:flex;gap:9px}
.tcSw{width:28px;height:28px;border-radius:50%;cursor:pointer;border:2px solid #fff;box-shadow:0 0 0 1px #e3e5e8}
.tcSw:hover{transform:scale(1.08)}
.tcSw.on{box-shadow:0 0 0 2px ${C.teal}}
.tcFld{margin-bottom:13px}
.tcFld label{display:block;font-size:11px;color:#6a6a6a;margin-bottom:5px;font-weight:500}
.tcFld input,.tcFld select{width:100%;border:1px solid #e3e5e8;border-radius:9px;padding:9px 11px;font-size:13px;outline:0;background:#fff}
.tcFld input:focus,.tcFld select:focus{border-color:${C.teal};box-shadow:0 0 0 3px #eaf6f4}
.tcMini{border:1px solid #e3e5e8;background:#fff;border-radius:8px;padding:7px 12px;font-size:12px;cursor:pointer;color:#454b50}
.tcMini:hover{background:#f6f7f9}
.tcOptRow{display:flex;align-items:center;justify-content:space-between;padding:9px 0;font-size:13px;color:#2a3034}
.tcOptRow+.tcOptRow{border-top:1px solid #ececef}
.tcToggle{position:relative;width:38px;height:22px;flex:0 0 auto}
.tcToggle input{display:none}
.tcToggle span{position:absolute;inset:0;background:#d4d8db;border-radius:20px;transition:.15s;cursor:pointer}
.tcToggle span:before{content:"";position:absolute;width:18px;height:18px;left:2px;top:2px;background:#fff;border-radius:50%;transition:.15s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.tcToggle input:checked+span{background:${C.teal}}
.tcToggle input:checked+span:before{transform:translateX(16px)}
.tcSubgroup{background:#f6f7f9;border-radius:11px;padding:10px 13px;margin-top:8px}
.tcInsEmpty{color:#8b9196;font-size:12px;text-align:center;margin:48px 16px;line-height:1.7}
.tcReq{color:#e0564f}
.tcHelp{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:rgba(12,18,22,.42);backdrop-filter:blur(2px)}
.tcHelpCard{width:min(420px,90vw);max-height:82vh;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 24px 60px rgba(8,18,24,.4)}
.tcHelpHead{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #ececef;position:sticky;top:0;background:#fff}
.tcHelpHead b{font-size:14px}
.tcHelpHead button{width:30px;height:30px;border:1px solid #e3e5e8;background:#fff;border-radius:8px;cursor:pointer;color:#5a6166}
.tcHelpBody{padding:8px 18px 20px}
.tcHelpBody h5{margin:18px 0 8px;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:${C.teal};font-weight:700}
.tcHelpBody ul{margin:0;padding:0;list-style:none}
.tcHelpBody li{position:relative;padding:4px 0 4px 14px;font-size:12.5px;line-height:1.6;color:#3a4044}
.tcHelpBody li:before{content:"•";position:absolute;left:0;color:${C.teal};font-weight:700}
.tcHelpBody code{font-family:${MONO};font-size:11.5px;background:#eaf6f4;color:${C.teal};padding:1px 6px;border-radius:5px;font-weight:600}
`;
