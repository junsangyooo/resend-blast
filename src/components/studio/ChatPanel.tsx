"use client";
// AI 채팅 패널. 이력은 메모리에만 (나가면 소멸 — 설계 결정).
import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ComposeEvent, ComposeMode, ImageRef } from "@/lib/ai/types";

type Bubble = ChatMessage & { pending?: boolean; error?: boolean };

export default function ChatPanel({ mode, getCurrent, onResult, onBusy }: {
  mode: ComposeMode;
  getCurrent: () => unknown;
  onResult: (r: { spec?: unknown; html?: string }) => void;
  onBusy?: (b: boolean) => void;
}) {
  const [msgs, setMsgs] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<(ImageRef & { uploading?: boolean; error?: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const acRef = useRef<AbortController | null>(null);
  const scrollDown = () => requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e9 }));

  useEffect(() => () => acRef.current?.abort(), []);

  async function attach(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (!/^image\//.test(f.type)) continue;
      const ref: ImageRef & { uploading?: boolean } = { url: "", filename: f.name, uploading: true };
      setImages((cur) => [...cur.filter((x) => x.filename !== f.name), ref]);
      try {
        const fd = new FormData(); fd.append("file", f);
        const r = await fetch("/api/upload", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok || !j.url) throw new Error(j.error ?? "업로드 실패");
        setImages((cur) => cur.map((x) => (x.filename === f.name ? { url: j.url, filename: f.name } : x)));
      } catch (e: any) {
        setImages((cur) => cur.map((x) => (x.filename === f.name ? { ...x, uploading: false, error: e?.message } : x)));
      }
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    setInput(""); setBusy(true); onBusy?.(true);
    const history: ChatMessage[] = [...msgs.filter((m) => !m.error).map(({ role, content }) => ({ role, content })), { role: "user", content }];
    setMsgs((cur) => [...cur, { role: "user", content }, { role: "assistant", content: "", pending: true }]);
    scrollDown();
    const setLast = (fn: (b: Bubble) => Bubble) => setMsgs((cur) => cur.map((m, i) => (i === cur.length - 1 ? fn(m) : m)));
    const ac = new AbortController();
    acRef.current = ac;
    try {
      const res = await fetch("/api/ai/compose", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, messages: history, current: getCurrent(),
          imageUrls: images.filter((x) => x.url && !x.error).map(({ url, filename }) => ({ url, filename })),
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
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        buf += dec.decode(value ?? new Uint8Array(), { stream: !d });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: ComposeEvent;
          try {
            ev = JSON.parse(line) as ComposeEvent;
          } catch {
            continue;
          }
          if (ev.type === "text") { setLast((m) => ({ ...m, content: m.content + ev.delta })); scrollDown(); }
          else if (ev.type === "retry") setLast((m) => ({ ...m, content: "", pending: true }));
          else if (ev.type === "result") { onResult(ev); setLast((m) => ({ ...m, pending: false, content: m.content || "반영했습니다." })); }
          else if (ev.type === "error") setLast(() => ({ role: "assistant", content: ev.message, error: true }));
        }
      }
      setImages([]); // 이번 턴에 전달 완료 — AI 가 spec 에 넣었으면 spec 이 진실
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setLast(() => ({ role: "assistant", content: e?.message ?? "요청 실패 — 다시 시도해 주세요.", error: true }));
    } finally {
      setBusy(false); onBusy?.(false); scrollDown();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto space-y-3 p-3">
        {msgs.length === 0 && (
          <div className="text-xs text-muted leading-relaxed p-2">
            <p className="font-semibold text-text mb-1">무엇을 만들까요?</p>
            <p>예: "6월 10일 데모데이 초청 메일. 어젠다 표와 신청 버튼 포함" — 이미지를 첨부하면 알맞은 자리에 배치합니다.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[92%] rounded-xl px-3 py-2 text-[13px] whitespace-pre-wrap leading-relaxed
            ${m.role === "user" ? "ml-auto bg-brand/10" : m.error ? "bg-red-500/10 text-red-600" : "bg-surface2"}`}>
            {m.content}{m.pending && <span className="animate-pulse">▍</span>}
          </div>
        ))}
      </div>
      {images.length > 0 && (
        <div className="px-3 pb-1 flex flex-wrap gap-1.5">
          {images.map((im) => (
            <span key={im.filename} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 text-[11px]">
              🖼 {im.filename}
              {im.uploading ? <span className="text-muted">…</span> : im.error ? <span className="text-red-500">실패</span> : <span className="text-green-600">✓</span>}
              <button className="text-muted hover:text-red-500" onClick={() => setImages((c) => c.filter((x) => x.filename !== im.filename))}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="border-t border-border px-2.5 pt-2.5 pb-5 flex items-end gap-1.5"
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); attach(e.dataTransfer.files); }}>
        <label className="btn-ghost text-[13px] py-1.5 px-2 cursor-pointer" title="이미지 첨부">
          🖼<input type="file" multiple accept="image/*" className="hidden" onChange={(e) => { attach(e.target.files); e.currentTarget.value = ""; }} />
        </label>
        <textarea
          className="input flex-1 resize-none text-[13px]" rows={2} value={input} placeholder={busy ? "생성 중…" : "요청을 입력하세요 (Enter 전송 / Shift+Enter 줄바꿈)"}
          disabled={busy} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        <button className="btn-primary py-1.5 px-3 text-[13px]" disabled={busy || !input.trim()} onClick={send}>{busy ? "…" : "전송"}</button>
      </div>
    </div>
  );
}
