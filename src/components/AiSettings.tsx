"use client";
// Settings → AI (admin only). Register / remove the Claude API key and test the connection.
// The key is write-only: the server returns only a 4-character hint.
import { useEffect, useState } from "react";

type Source = "settings" | "env" | "cli";
type Status = { source: Source; keyHint?: string; updatedAt?: string; updatedBy?: string; envKey: boolean; model: string };

const SOURCE_LABEL: Record<Source, string> = {
  settings: "설정에 등록한 키",
  env: ".env.local 키",
  cli: "서버 Claude CLI 로그인",
};

export default function AiSettings() {
  const [st, setSt] = useState<Status | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const r = await fetch("/api/ai/settings").then((x) => x.json()).catch(() => null);
    if (r && !r.error) setSt(r);
    else setErr(r?.error ?? "불러오기 실패");
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true); setErr(""); setTest(null);
    const r = await fetch("/api/ai/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: key }),
    }).then((x) => x.json()).catch(() => ({ error: "저장 실패" }));
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setSt(r); setKey("");
  }

  async function remove() {
    setBusy(true); setErr(""); setTest(null);
    const r = await fetch("/api/ai/settings", { method: "DELETE" }).then((x) => x.json()).catch(() => ({ error: "삭제 실패" }));
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setSt(r);
  }

  async function runTest() {
    setBusy(true); setErr(""); setTest(null);
    const r = await fetch("/api/ai/settings", { method: "POST" }).then((x) => x.json()).catch(() => ({ ok: false, error: "연결 확인 실패" }));
    setBusy(false);
    setTest(r.ok
      ? { ok: true, text: `연결 정상 · ${SOURCE_LABEL[r.source as Source]} · ${(r.ms / 1000).toFixed(1)}초` }
      : { ok: false, text: r.error ?? "연결 실패" });
  }

  if (!st) return <p className="text-[12px] text-muted">{err || "불러오는 중…"}</p>;

  return (
    <div className="space-y-3 text-[12px]">
      <div className="card p-3 space-y-1.5 bg-surface2/30">
        <div className="flex justify-between gap-3"><span className="text-muted">사용 중</span><span className="font-medium text-text">{SOURCE_LABEL[st.source]}{st.source === "settings" && st.keyHint ? ` (${st.keyHint})` : ""}</span></div>
        <div className="flex justify-between gap-3"><span className="text-muted">모델</span><span className="font-mono text-text/90">{st.model}</span></div>
        {st.updatedAt && st.source === "settings" && (
          <div className="flex justify-between gap-3"><span className="text-muted">등록</span><span className="text-text/80">{new Date(st.updatedAt).toLocaleString("ko-KR")} · {st.updatedBy}</span></div>
        )}
        <div className="text-[11px] text-muted pt-1">우선순위: 설정 키 → .env.local 키 → 서버 Claude CLI 로그인</div>
      </div>

      <div className="card p-3 space-y-2">
        <div className="text-[11px] text-muted">Claude API 키 {st.source === "settings" ? "교체" : "등록"}</div>
        <div className="flex gap-2">
          <input
            type="password" autoComplete="off" spellCheck={false}
            className="input py-1.5 text-[12px] font-mono flex-1"
            value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…"
          />
          <button onClick={save} disabled={busy || !key.trim()} className="btn-primary text-xs shrink-0">저장</button>
        </div>
        {err && <p className="text-[11px] text-red-500">{err}</p>}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={runTest} disabled={busy} className="btn-ghost text-xs">{busy ? "확인 중…" : "연결 확인"}</button>
        {st.source === "settings" && <button onClick={remove} disabled={busy} className="text-[11px] text-muted hover:text-red-500">키 삭제</button>}
        {test && <span className={`text-[12px] ${test.ok ? "text-emerald-600" : "text-red-500"}`}>{test.ok ? "✓ " : ""}{test.text}</span>}
      </div>
    </div>
  );
}
