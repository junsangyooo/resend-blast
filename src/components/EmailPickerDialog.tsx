"use client";

import { useEffect, useMemo, useState } from "react";
import { useEscClose } from "./hooks";

export type PickerTemplate = {
  /** Internal id. */
  name: string;
  /** Display name. */
  title: string;
  subject: string;
  description: string;
  composed: boolean;
  createdBy?: string;
  lastModifiedAt?: string;
};

/**
 * 이메일 선택 팝업 — 모든 이메일이 항상 노출된다(보관함 개념 없음).
 * 행 클릭 = 선택, 우측 액션 = 스튜디오 편집 / 영구 삭제.
 * 삭제 버튼은 만든 사람·관리자에게만 보이며 서버(deleteTemplate)도 동일하게 강제한다.
 * 복제는 누구나 — 사본은 복제한 사람 소유가 되고 목록 맨 위에 선택된 채로 나타난다.
 */
export default function EmailPickerDialog({
  open, templates, selected, me, isAdmin, onSelect, onEdit, onChanged, onClose,
}: {
  open: boolean;
  templates: PickerTemplate[];
  selected: string;
  me: string;
  isAdmin: boolean;
  onSelect: (name: string) => void;
  onEdit: (name: string) => void;
  /** Called after a list change; with the new id after a duplicate (so the caller can select it). */
  onChanged: (selectName?: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEscClose(open, onClose);
  useEffect(() => {
    if (open) { setQuery(""); setConfirmName(null); setErr(""); }
  }, [open]);

  // Most recently modified first (legacy entries with no history fall back to name order).
  const shown = useMemo(() => {
    const sorted = [...templates].sort(
      (a, b) => (b.lastModifiedAt ?? "").localeCompare(a.lastModifiedAt ?? "") || a.name.localeCompare(b.name)
    );
    const q = query.trim().toLowerCase();
    return q ? sorted.filter((t) => `${t.title} ${t.subject} ${t.description}`.toLowerCase().includes(q)) : sorted;
  }, [templates, query]);

  if (!open) return null;

  const canDelete = (t: PickerTemplate) =>
    isAdmin || (!!t.createdBy && !!me && t.createdBy.toLowerCase() === me.toLowerCase());

  async function duplicate(name: string) {
    setBusy(name); setErr("");
    try {
      const r = await fetch("/api/templates/duplicate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "복제 실패");
      onChanged(j.name);
    } catch (e: any) {
      setErr(e?.message ?? "복제 실패");
    } finally {
      setBusy(null);
    }
  }

  async function del(name: string) {
    setBusy(name); setErr("");
    try {
      const r = await fetch(`/api/templates?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "삭제 실패");
      setConfirmName(null);
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "삭제 실패");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <div className="kicker">Emails</div>
            <h2 className="mt-0.5 text-base font-semibold">이메일 선택</h2>
          </div>
          <button onClick={onClose} className="icon-btn" title="닫기">✕</button>
        </div>

        {templates.length > 6 && (
          <div className="px-5 pt-3 shrink-0">
            <input
              autoFocus
              className="input py-1.5 text-[12px]"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="🔍 이메일 검색 (이름·제목·설명)"
            />
          </div>
        )}

        {err && <div className="mx-5 mt-3 text-[12px] text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2 shrink-0">{err}</div>}

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {templates.length === 0 && (
            <div className="text-xs text-muted text-center py-12 border border-dashed border-border rounded-xl">
              아직 만든 이메일이 없습니다. ‘새로 만들기’로 첫 이메일을 만드세요.
            </div>
          )}
          {templates.length > 0 && shown.length === 0 && (
            <div className="text-xs text-muted py-8 text-center">‘{query}’ 검색 결과가 없습니다.</div>
          )}
          {shown.map((t) => {
            const active = t.name === selected;
            const confirming = confirmName === t.name;
            return (
              <div
                key={t.name}
                className={`relative rounded-xl border transition ${
                  active ? "border-brand bg-brand/5 ring-1 ring-brand/30" : "border-border hover:border-brand/40"
                }`}
              >
                <button onClick={() => onSelect(t.name)} className="w-full text-left p-3.5 pr-[104px]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-text/90 truncate">{t.title}</span>
                    {t.composed && <span className="chip shrink-0">블록</span>}
                    {active && <span className="chip shrink-0 border-brand/40 text-brand">선택됨</span>}
                  </div>
                  <div className="text-[12px] text-text/70 mt-1 truncate">제목: {t.subject}</div>
                  <div className="text-[11px] text-muted mt-0.5 truncate">
                    {t.description && <span>{t.description} · </span>}
                    {t.createdBy ? `만든 사람 ${t.createdBy.split("@")[0]}` : "만든 사람 미기록"}
                  </div>
                </button>

                <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5">
                  <button onClick={() => duplicate(t.name)} disabled={busy === t.name} title="복제해서 새 이메일 만들기" className="icon-btn text-muted/60 hover:text-brand">
                    <CopyIcon />
                  </button>
                  <button onClick={() => onEdit(t.name)} title="스튜디오에서 수정" className="icon-btn text-muted/60 hover:text-brand">
                    <EditIcon />
                  </button>
                  {canDelete(t) && (
                    <button
                      onClick={() => setConfirmName(t.name)}
                      title="영구 삭제 (만든 사람·관리자만)"
                      className="icon-btn text-muted/60 hover:text-red-500"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>

                {confirming && (
                  <div className="px-3.5 pb-3 flex items-center justify-end gap-2">
                    <span className="text-[11px] text-red-600 mr-auto">되돌릴 수 없습니다. 정말 삭제할까요?</span>
                    <button onClick={() => setConfirmName(null)} className="btn-ghost text-xs">취소</button>
                    <button
                      onClick={() => del(t.name)}
                      disabled={busy === t.name}
                      className="btn text-xs bg-red-600 text-white hover:opacity-90"
                    >
                      {busy === t.name ? "삭제 중…" : "삭제"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
