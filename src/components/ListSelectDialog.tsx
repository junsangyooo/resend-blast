"use client";

import { useEffect, useState } from "react";
import { useEscClose } from "./hooks";

export type ListRow = {
  slug: string;
  name: string;
  description: string;
  memberCount: number;
  createdBy: string;
  updatedAt: string;
};

/**
 * List selection popup — checkbox multi-select + per-row edit/delete (replaces a separate management screen).
 * When several lists are selected, members are deduped by email; if the same address is in multiple lists,
 * the name from the list selected first wins (the row's order badge = priority).
 * Members of a list marked '제외' are dropped from this send even if they appear in other lists or direct input.
 */
export default function ListSelectDialog({
  open, lists, selected, excluded, dedupedCount, me, isAdmin, onChange, onExcludeChange, onEdit, onCreate, onChanged, onClose,
}: {
  open: boolean;
  lists: ListRow[];
  selected: string[];
  /** Lists whose members are removed from the send. */
  excluded: string[];
  onExcludeChange: (slugs: string[]) => void;
  /** Headcount of the selected lists after email dedupe (computed by the parent from the member preview). */
  dedupedCount: number;
  me: string;
  isAdmin: boolean;
  onChange: (slugs: string[]) => void;
  onEdit: (slug: string) => void;
  onCreate: () => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEscClose(open, onClose);
  useEffect(() => {
    if (open) { setQuery(""); setConfirmSlug(null); setErr(""); }
  }, [open]);

  if (!open) return null;

  const canManage = (l: ListRow) =>
    isAdmin || (!!me && l.createdBy.toLowerCase() === me.toLowerCase());

  const q = query.trim().toLowerCase();
  const shown = q
    ? lists.filter((l) => `${l.name} ${l.slug} ${l.description ?? ""}`.toLowerCase().includes(q))
    : lists;

  const rawSum = lists
    .filter((l) => selected.includes(l.slug))
    .reduce((acc, l) => acc + l.memberCount, 0);
  const dupExcluded = dedupedCount > 0 && dedupedCount < rawSum ? rawSum - dedupedCount : 0;

  function toggle(slug: string) {
    if (excluded.includes(slug)) onExcludeChange(excluded.filter((s) => s !== slug));
    onChange(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug]);
  }
  function toggleExclude(slug: string) {
    if (excluded.includes(slug)) { onExcludeChange(excluded.filter((s) => s !== slug)); return; }
    if (selected.includes(slug)) onChange(selected.filter((s) => s !== slug));
    onExcludeChange([...excluded, slug]);
  }

  async function del(slug: string) {
    setBusy(slug); setErr("");
    try {
      const r = await fetch(`/api/lists/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "삭제 실패");
      setConfirmSlug(null);
      onChange(selected.filter((s) => s !== slug));
      onExcludeChange(excluded.filter((s) => s !== slug));
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
            <div className="kicker">Recipient Lists</div>
            <h2 className="mt-0.5 text-base font-semibold">리스트 선택</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onCreate} className="btn-ghost text-xs">＋ 새 리스트</button>
            <button onClick={onClose} className="icon-btn" title="닫기">✕</button>
          </div>
        </div>

        {lists.length > 6 && (
          <div className="px-5 pt-3 shrink-0">
            <input
              className="input py-1.5 text-[12px]"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="🔍 리스트 검색 (이름·슬러그·설명)"
            />
          </div>
        )}

        {err && <div className="mx-5 mt-3 text-[12px] text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2 shrink-0">{err}</div>}

        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {lists.length === 0 && (
            <div className="text-xs text-muted text-center py-12 border border-dashed border-border rounded-xl">
              아직 리스트가 없습니다. 우측 상단 <span className="text-brand">＋ 새 리스트</span> 로 만드세요.
            </div>
          )}
          {lists.length > 0 && shown.length === 0 && (
            <div className="text-xs text-muted py-8 text-center">‘{query}’ 검색 결과가 없습니다.</div>
          )}
          {shown.map((l) => {
            const active = selected.includes(l.slug);
            const isExcluded = excluded.includes(l.slug);
            const order = selected.indexOf(l.slug);
            const confirming = confirmSlug === l.slug;
            return (
              <div
                key={l.slug}
                className={`rounded-xl border transition ${active ? "border-brand bg-brand/5" : isExcluded ? "border-red-400/60 bg-red-500/5" : "border-border hover:border-brand/40"}`}
              >
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  <button
                    onClick={() => toggle(l.slug)}
                    className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                    aria-pressed={active}
                  >
                    <span
                      className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${
                        active ? "bg-brand border-brand text-white" : "border-border"
                      }`}
                    >
                      {active ? "✓" : ""}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className={`text-[13px] font-medium truncate ${isExcluded ? "text-red-600 line-through decoration-red-400/60" : "text-text/90"}`}>{l.name}</span>
                        {isExcluded && <span className="chip shrink-0 border-red-400/50 text-red-600">해당 리스트의 인원은 발송 대상에서 제외됩니다</span>}
                        {active && selected.length > 1 && (
                          <span className="chip shrink-0 border-brand/40 text-brand" title="이름 우선순위 — 같은 주소가 여러 리스트에 있으면 먼저 선택한 리스트의 이름 사용">
                            {order + 1}순위
                          </span>
                        )}
                      </span>
                      {l.description && <span className="block text-[10px] text-muted truncate">{l.description}</span>}
                    </span>
                    <span className="text-[11px] text-muted shrink-0 tabular-nums">{l.memberCount}명</span>
                  </button>
                  <span className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => toggleExclude(l.slug)}
                      title={isExcluded ? "제외 해제" : "이 리스트의 사람들을 이번 발송에서 빼기"}
                      className={`text-[11px] px-2 py-1 rounded-lg border mr-1 transition ${isExcluded ? "border-red-400/60 text-red-600 bg-red-500/10" : "border-border text-muted hover:text-red-600 hover:border-red-400/50"}`}
                    >
                      {isExcluded ? "제외됨" : "제외"}
                    </button>
                    <button onClick={() => onEdit(l.slug)} title={canManage(l) ? "리스트 수정" : "멤버 추가 (수정·삭제는 만든 사람만)"} className="icon-btn text-muted/60 hover:text-brand">
                      <EditIcon />
                    </button>
                    {canManage(l) && (
                      <button
                        onClick={() => setConfirmSlug(l.slug)}
                        title="리스트 삭제 (만든 사람·관리자만)"
                        className="icon-btn text-muted/60 hover:text-red-500"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </span>
                </div>
                {confirming && (
                  <div className="px-3 pb-2.5 flex items-center justify-end gap-2">
                    <span className="text-[11px] text-red-600 mr-auto">‘{l.name}’ 을(를) 삭제할까요? 되돌릴 수 없습니다.</span>
                    <button onClick={() => setConfirmSlug(null)} className="btn-ghost text-xs">취소</button>
                    <button
                      onClick={() => del(l.slug)}
                      disabled={busy === l.slug}
                      className="btn text-xs bg-red-600 text-white hover:opacity-90"
                    >
                      {busy === l.slug ? "삭제 중…" : "삭제"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-muted min-w-0 truncate">
            {selected.length === 0 ? (
              "리스트를 체크해 수신자에 추가하세요"
            ) : (
              <>
                <b className="text-text/80">{selected.length}개</b> 선택 · 합계 {rawSum}명
                {dupExcluded > 0 && (
                  <> → 중복 {dupExcluded}명 제외 <b className="text-brand">{dedupedCount}명</b></>
                )}
              </>
            )}
            {excluded.length > 0 && <span className="text-red-600"> · 제외 리스트 {excluded.length}개</span>}
          </div>
          <button onClick={onClose} className="btn-primary text-sm shrink-0">완료</button>
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
