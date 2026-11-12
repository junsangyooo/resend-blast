"use client";
// AI chat panel. Conversation history lives in memory only (lost on leaving — a design decision).
// Progress display: analyze request → write email (char count) → format check → applied, with elapsed time and a stop button.
import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ComposeEvent, ComposeMode, ImageRef } from "@/lib/ai/types";
import { EXT_BY_TYPE, MAX_UPLOAD_BYTES } from "@/lib/storage/image-validation";

/** Same rule as the server (/api/upload): PNG·JPG·GIF·WEBP, 5MB. Checked before uploading. */
const ACCEPT = Object.keys(EXT_BY_TYPE).join(",");
const UPLOAD_RULE = `지원 형식 PNG·JPG·GIF·WEBP · ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 이하`;

type Phase = "analyzing" | "writing" | "checking" | "retrying" | "done" | "error" | "stopped";
type Attachment = ImageRef & { id: string; preview: string; uploading?: boolean; error?: boolean };
type Bubble = ChatMessage & {
  images?: { url: string; preview: string }[];
  phase?: Phase;
  chars?: number;
  startedAt?: number;
  endedAt?: number;
  summary?: string;
};

const EXAMPLES: Record<"new" | "edit", string[]> = {
  new: [
    "데모데이 초청 메일 · 어젠다 표와 신청 버튼",
    "행사 D-1 리마인더 · 장소와 시간 강조",
    "뉴스레터 · 소식 3개를 카드로",
  ],
  edit: [
    "제목을 더 짧고 강하게",
    "버튼 문구를 '신청하기'로",
    "어젠다 시간을 모두 30분 뒤로",
  ],
};

export default function ChatPanel({ mode, isNew, getCurrent, onResult, onBusy, canUndoLast, onUndoLast }: {
  mode: ComposeMode;
  /** New email (examples for creating) vs editing an existing one. */
  isNew: boolean;
  getCurrent: () => unknown;
  /** Apply the AI result; returns a short noun-phrase summary for the chat (e.g. "블록 3개 변경"). */
  onResult: (r: { spec?: unknown; html?: string }) => string | void;
  onBusy?: (b: boolean) => void;
  /** The latest undo step is this AI result (so "되돌리기" is meaningful). */
  canUndoLast?: boolean;
  onUndoLast?: () => void;
}) {
  const [msgs, setMsgs] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [attachErr, setAttachErr] = useState("");
  const [, setTick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const acRef = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);
  const scrollDown = () => requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }));

  useEffect(() => () => acRef.current?.abort(), []);
  // Elapsed-time ticker while a request runs.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);
  // Auto-grow the input (1–8 lines).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 8 * 20 + 16)}px`;
  }, [input]);

  async function attach(files: FileList | File[] | null) {
    if (!files) return;
    setAttachErr("");
    for (const f of Array.from(files)) {
      // Rejected up front with the rule, instead of a failed thumbnail with no reason.
      if (!(f.type in EXT_BY_TYPE) || f.size > MAX_UPLOAD_BYTES) {
        setAttachErr(`${f.name || "파일"} 제외 · ${UPLOAD_RULE}`);
        continue;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const preview = URL.createObjectURL(f);
      setAtts((cur) => [...cur, { id, url: "", filename: f.name || "image.png", preview, uploading: true }]);
      try {
        const fd = new FormData(); fd.append("file", f);
        const r = await fetch("/api/upload", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok || !j.url) throw new Error();
        setAtts((cur) => cur.map((a) => (a.id === id ? { ...a, url: j.url, uploading: false } : a)));
      } catch {
        setAtts((cur) => cur.map((a) => (a.id === id ? { ...a, uploading: false, error: true } : a)));
      }
    }
  }

  const setLast = (fn: (b: Bubble) => Bubble) => setMsgs((cur) => cur.map((m, i) => (i === cur.length - 1 ? fn(m) : m)));

  async function send(textOverride?: string) {
    const content = (textOverride ?? input).trim();
    if (!content || busy || atts.some((a) => a.uploading)) return;
    const sentImages = atts.filter((a) => a.url && !a.error);
    setInput(""); setAtts([]);
    setBusy(true); onBusy?.(true);
    const failed = (m?: Bubble) => m?.phase === "error" || m?.phase === "stopped";
    const history: ChatMessage[] = [
      ...msgs
        .filter((m, i) => !failed(m) && !(m.role === "user" && failed(msgs[i + 1])))
        .map(({ role, content }) => ({ role, content })),
      { role: "user", content },
    ];
    setMsgs((cur) => [
      ...cur,
      { role: "user", content, images: sentImages.map((a) => ({ url: a.url, preview: a.preview })) },
      { role: "assistant", content: "", phase: "analyzing", startedAt: Date.now() },
    ]);
    scrollDown();
    const ac = new AbortController();
    acRef.current = ac;
    try {
      const res = await fetch("/api/ai/compose", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, messages: history, current: getCurrent(),
          imageUrls: sentImages.map(({ url, filename }) => ({ url, filename })),
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `요청 실패 (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        buf += dec.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: ComposeEvent;
          try { ev = JSON.parse(line) as ComposeEvent; } catch { continue; }
          if (ev.type === "text") { setLast((m) => ({ ...m, content: m.content + ev.delta })); scrollDown(); }
          else if (ev.type === "progress") setLast((m) => ({ ...m, phase: ev.phase, chars: ev.chars ?? m.chars }));
          else if (ev.type === "retry") setLast((m) => ({ ...m, content: "", phase: "retrying", chars: undefined }));
          else if (ev.type === "result") {
            const summary = onResult(ev) || "반영 완료";
            setLast((m) => ({ ...m, phase: "done", endedAt: Date.now(), summary }));
          } else if (ev.type === "error") setLast((m) => ({ ...m, phase: "error", endedAt: Date.now(), summary: ev.message }));
        }
        if (done) break;
      }
    } catch (e: any) {
      if (e?.name === "AbortError") setLast((m) => ({ ...m, phase: "stopped", endedAt: Date.now(), summary: "요청 중지" }));
      else setLast((m) => ({ ...m, phase: "error", endedAt: Date.now(), summary: e?.message ?? "요청 실패" }));
    } finally {
      setBusy(false); onBusy?.(false); scrollDown();
      acRef.current = null;
    }
  }

  function stop() { acRef.current?.abort(); }

  /** Re-send the request of a failed/stopped answer. */
  function retry(i: number) {
    const prevUser = [...msgs.slice(0, i)].reverse().find((m) => m.role === "user");
    if (prevUser) send(prevUser.content);
  }

  const examples = EXAMPLES[isNew ? "new" : "edit"];
  const lastAssistant = msgs.length - 1;

  return (
    <div
      className="relative flex flex-col h-full min-h-0"
      onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) { dragDepth.current++; setDragging(true); } }}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); attach(e.dataTransfer.files); }}
    >
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {msgs.length === 0 && (
          <div className="pt-6">
            <div className="flex items-center gap-2 text-text">
              <span className="text-brand"><SparkIcon /></span>
              <span className="text-[15px] font-semibold">{isNew ? "새 이메일" : "수정 요청"}</span>
            </div>
            <p className="text-[12.5px] text-muted mt-1">요청 입력 · 이미지 첨부 시 알맞은 자리에 배치</p>
            <div className="mt-4 flex flex-col gap-1.5">
              {examples.map((ex) => (
                <button key={ex} onClick={() => { setInput(ex); taRef.current?.focus(); }}
                  className="text-left text-[13px] rounded-lg border border-border px-3 py-2 hover:border-brand/50 hover:bg-brand/5 transition">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex flex-col items-end gap-1.5">
              {m.images && m.images.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {m.images.map((im) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={im.url} src={im.preview || im.url} alt="" className="w-16 h-16 object-cover rounded-lg border border-border" />
                  ))}
                </div>
              )}
              <div className="max-w-[88%] rounded-2xl rounded-br-md bg-brand/10 px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="flex gap-2.5">
              <span className={`mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${m.phase === "error" ? "bg-red-500/10 text-red-500" : "bg-brand/10 text-brand"}`}>
                <SparkIcon small />
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                {m.content && <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-text/90">{m.content}</div>}
                <Status m={m} />
                {m.phase === "done" && i === lastAssistant && canUndoLast && onUndoLast && (
                  <button onClick={onUndoLast} className="text-[12px] text-muted hover:text-text underline">되돌리기</button>
                )}
                {(m.phase === "error" || m.phase === "stopped") && i === lastAssistant && !busy && (
                  <button onClick={() => retry(i)} className="text-[12px] text-brand hover:underline">다시 시도</button>
                )}
              </div>
            </div>
          ),
        )}
      </div>

      {/* Input */}
      <div className="px-3 pb-4 pt-2 shrink-0">
        <div className={`rounded-2xl border bg-surface transition ${busy ? "border-border" : "border-border focus-within:border-brand/60 focus-within:ring-2 focus-within:ring-brand/15"}`}>
          {atts.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {atts.map((a) => (
                <div key={a.id} className="relative w-14 h-14">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.preview} alt={a.filename} title={a.filename}
                    className={`w-14 h-14 object-cover rounded-lg border ${a.error ? "border-red-400" : "border-border"} ${a.uploading ? "opacity-50" : ""}`} />
                  {a.uploading && <span className="absolute inset-0 flex items-center justify-center"><Spinner /></span>}
                  {a.error && <span className="absolute inset-x-0 bottom-0 text-center text-[10px] bg-red-500 text-white rounded-b-lg">실패</span>}
                  <button onClick={() => setAtts((c) => c.filter((x) => x.id !== a.id))} aria-label="첨부 제거"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-text text-bg text-[11px] leading-none flex items-center justify-center shadow">✕</button>
                </div>
              ))}
            </div>
          )}
          {attachErr && (
            <div className="flex items-center gap-2 px-3.5 pt-2.5 text-[12px] text-red-500">
              <span className="flex-1">{attachErr}</span>
              <button onClick={() => setAttachErr("")} className="text-muted hover:text-text" aria-label="닫기">✕</button>
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13.5px] leading-5 outline-none placeholder:text-muted/70"
            value={input}
            placeholder={busy ? "AI 작업 중" : isNew ? "만들 이메일 설명" : "수정할 내용"}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files ?? []);
              if (files.length) { e.preventDefault(); attach(files); }
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-text hover:bg-surface2 disabled:opacity-40" title={`이미지 첨부 · 끌어놓기·붙여넣기 가능 · ${UPLOAD_RULE}`} aria-label="이미지 첨부">
              <ImageIcon />
            </button>
            <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden"
              onChange={(e) => { attach(e.target.files); e.currentTarget.value = ""; }} />
            <span className="ml-1 text-[11px] text-muted/80 hidden sm:inline">⏎ 전송 · ⇧⏎ 줄바꿈</span>
            <span className="flex-1" />
            {busy ? (
              <button onClick={stop} className="w-8 h-8 rounded-full bg-text text-bg flex items-center justify-center hover:opacity-90" title="중지" aria-label="중지">
                <StopIcon />
              </button>
            ) : (
              <button onClick={() => send()} disabled={!input.trim() || atts.some((a) => a.uploading)}
                className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center hover:opacity-90 disabled:opacity-30" title="전송" aria-label="전송">
                <ArrowUpIcon />
              </button>
            )}
          </div>
        </div>
      </div>

      {dragging && (
        <div className="absolute inset-2 z-20 rounded-2xl border-2 border-dashed border-brand bg-brand/5 flex items-center justify-center pointer-events-none">
          <span className="flex items-center gap-2 text-brand text-[13px] font-semibold"><ImageIcon /> 이미지 놓기</span>
        </div>
      )}
    </div>
  );
}

/** Step line under an assistant message: 분석 → 작성 → 검사, then the outcome. */
function Status({ m }: { m: Bubble }) {
  const secs = Math.max(0, Math.round(((m.endedAt ?? Date.now()) - (m.startedAt ?? Date.now())) / 1000));
  if (m.phase === "done") {
    return (
      <div className="flex items-center gap-1.5 text-[12px] text-green-600">
        <CheckIcon /> <span>{m.summary}</span><span className="text-muted">· {secs}초</span>
      </div>
    );
  }
  if (m.phase === "error" || m.phase === "stopped") {
    return <div className={`text-[12px] ${m.phase === "error" ? "text-red-500" : "text-muted"}`}>{m.summary}</div>;
  }
  const order: Phase[] = ["analyzing", "writing", "checking"];
  const cur = m.phase === "retrying" ? "writing" : (m.phase ?? "analyzing");
  const idx = order.indexOf(cur);
  const label = (p: Phase) =>
    p === "analyzing" ? "요청 분석"
    : p === "writing" ? (m.phase === "retrying" ? "형식 재작성" : "이메일 작성") + (m.chars ? ` ${m.chars >= 1000 ? `${(m.chars / 1000).toFixed(1)}k` : m.chars}자` : "")
    : "형식 검사";
  return (
    <div className="flex items-center gap-3 text-[12px]">
      {order.map((p, i) => (
        <span key={p} className={`flex items-center gap-1.5 ${i < idx ? "text-muted" : i === idx ? "text-text font-medium" : "text-muted/50"}`}>
          {i < idx ? <CheckIcon /> : i === idx ? <Spinner /> : <span className="w-3 h-3 rounded-full border border-current" />}
          {label(p)}
        </span>
      ))}
      <span className="ml-auto text-muted tabular-nums">{secs}초</span>
    </div>
  );
}

function SparkIcon({ small = false }: { small?: boolean }) {
  const s = small ? 13 : 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 5.8L20 10l-6.1 2.2L12 18l-1.9-5.8L4 10l6.1-2.2L12 2zM19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9L19 15z" />
    </svg>
  );
}
function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.6" /><path d="M21 15l-5-5L5 21" />
    </svg>
  );
}
function ArrowUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
function StopIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="5" y="5" width="14" height="14" rx="2" /></svg>;
}
function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.2-8.6" strokeLinecap="round" />
    </svg>
  );
}
