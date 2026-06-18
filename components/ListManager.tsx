"use client";

import { useEffect, useState } from "react";
import ListEditor from "./ListEditor";
import { useEscClose } from "./hooks";

type ListSummary = {
  slug: string;
  name: string;
  description: string;
  memberCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * 리스트 목록 화면 — 검색 · 카드 · 생성/편집 진입.
 * 실제 생성/편집/삭제 UI 는 ListEditor 가 담당(SendForm 인라인 추가와 공용).
 */
export default function ListManager({
  open,
  onClose,
  me,
  isAdmin = false,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  me: string | null;
  isAdmin?: boolean;
  onChanged: () => void;
}) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open]);

  useEscClose(open && !editingSlug && !creating, onClose);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/lists");
      const j = await r.json();
      setLists(j.lists ?? []);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  function close() {
    setEditingSlug(null);
    setCreating(false);
    onClose();
  }

  const shown = query.trim()
    ? lists.filter((l) => `${l.name} ${l.slug} ${l.description ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    : lists;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={close}>
      <div className="card w-full max-w-3xl h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <div className="kicker">Recipient Lists</div>
            <h2 className="mt-0.5 text-base font-semibold">수신자 리스트 관리</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setCreating(true)} className="btn-primary text-sm">＋ 새 리스트</button>
            <button onClick={close} className="icon-btn" title="닫기">✕</button>
          </div>
        </div>

        {lists.length > 6 && (
          <div className="px-5 pt-3 shrink-0">
            <input className="input py-1.5 text-[12px]" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 리스트 검색 (이름·슬러그·설명)" />
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {loading && lists.length === 0 && <div className="text-xs text-muted text-center py-10">불러오는 중…</div>}
          {!loading && lists.length === 0 && (
            <div className="text-xs text-muted text-center py-12 border border-dashed border-border rounded-xl">
              아직 리스트가 없습니다. 우측 상단 <span className="text-brand">＋ 새 리스트</span> 로 만드세요.
            </div>
          )}
          {lists.length > 0 && shown.length === 0 && (
            <div className="text-xs text-muted text-center py-8">‘{query}’ 검색 결과가 없습니다.</div>
          )}
          {shown.map((l) => (
            <button
              key={l.slug}
              onClick={() => setEditingSlug(l.slug)}
              className="w-full text-left rounded-xl border border-border hover:border-brand/40 p-3.5 transition"
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-text/90 font-semibold truncate">{l.name}</span>
                <span className="text-[10px] text-muted font-mono">{l.slug}</span>
                <span className="ml-auto chip">{l.memberCount}명</span>
              </div>
              {l.description && <div className="text-[11px] text-muted mt-1 truncate">{l.description}</div>}
              <div className="text-[10px] text-muted mt-1">
                생성: {l.createdBy} · 수정 {new Date(l.updatedAt).toLocaleString("ko-KR")}
              </div>
            </button>
          ))}
        </div>
      </div>

      {(creating || editingSlug) && (
        <ListEditor
          slug={editingSlug}
          me={me}
          isAdmin={isAdmin}
          onClose={() => { setCreating(false); setEditingSlug(null); }}
          onSaved={() => { refresh(); onChanged(); }}
        />
      )}
    </div>
  );
}
