"use client";

import { useEffect, useState } from "react";
import { useEscClose } from "./hooks";

type Template = { name: string; subject: string; description: string; composed: boolean; archived: boolean };

export default function ArchiveDialog({
  open, onClose, reloadKey, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  reloadKey: number;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setConfirmName(null); return; }
    setLoading(true);
    fetch("/api/templates")
      .then((r) => r.json())
      .then((j) => setItems((j.templates ?? []).filter((t: Template) => t.archived)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, reloadKey]);

  useEscClose(open, onClose);

  if (!open) return null;

  async function restore(name: string) {
    setBusy(name);
    try {
      await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, archived: false }),
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function del(name: string) {
    setBusy(name);
    try {
      await fetch(`/api/templates?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      setConfirmName(null);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <div className="kicker">Archive</div>
            <h2 className="mt-0.5 text-base font-semibold">보관함</h2>
          </div>
          <button onClick={onClose} className="icon-btn" title="닫기">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && <div className="text-xs text-muted text-center py-6">불러오는 중…</div>}
          {!loading && items.length === 0 && (
            <div className="text-xs text-muted text-center py-10 border border-dashed border-border rounded-xl">
              보관된 이메일이 없습니다.
            </div>
          )}
          {items.map((t) => (
            <div key={t.name} className="rounded-xl border border-border p-3.5">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[12px] text-text/90 truncate">{t.name}</span>
                {t.composed && <span className="chip shrink-0">블록</span>}
              </div>
              <div className="text-[12px] text-text/70 mt-1 truncate">{t.subject}</div>

              {confirmName === t.name ? (
                <div className="mt-3 flex items-center justify-end gap-2">
                  <span className="text-[11px] text-red-600 mr-auto">되돌릴 수 없습니다. 정말 삭제할까요?</span>
                  <button onClick={() => setConfirmName(null)} className="btn-ghost text-xs">취소</button>
                  <button onClick={() => del(t.name)} disabled={busy === t.name}
                    className="btn text-xs bg-red-600 text-white hover:opacity-90">
                    {busy === t.name ? "삭제 중…" : "삭제"}
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button onClick={() => restore(t.name)} disabled={busy === t.name} className="btn-ghost text-xs">
                    {busy === t.name ? "복원 중…" : "↩ 복원"}
                  </button>
                  <button onClick={() => setConfirmName(t.name)} className="btn-ghost text-xs hover:border-red-400/60 hover:text-red-600">
                    🗑 삭제
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
