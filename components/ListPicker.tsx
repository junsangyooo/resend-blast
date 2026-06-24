"use client";

import { useEffect, useState } from "react";

type ListSummary = {
  slug: string;
  name: string;
  description: string;
  memberCount: number;
  createdBy: string;
  updatedAt: string;
};

/**
 * List multi-select UI. Used inside SendForm.
 * Passes only the selected slug array to the parent. Dedupe happens on the server.
 */
export default function ListPicker({
  selected,
  onChange,
  reloadKey,
  onManage,
  onQuickAdd,
}: {
  selected: string[];
  onChange: (slugs: string[]) => void;
  reloadKey: number;
  onManage: () => void;
  /** Inline quick list creation (without going through the management modal). */
  onQuickAdd: () => void;
}) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetch("/api/lists")
      .then((r) => r.json())
      .then((j) => { if (!cancel) setLists(j.lists ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reloadKey]);

  function toggle(slug: string) {
    if (selected.includes(slug)) onChange(selected.filter((s) => s !== slug));
    else onChange([...selected, slug]);
  }

  const totalSelected = lists
    .filter((l) => selected.includes(l.slug))
    .reduce((acc, l) => acc + l.memberCount, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted">
          리스트 {selected.length > 0 && <span className="text-brand">· {selected.length}개 선택 (총 {totalSelected}명, 중복 제외 전)</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onQuickAdd} className="text-[11px] text-brand hover:underline">＋ 리스트 추가</button>
          <span className="text-muted/40">·</span>
          <button onClick={onManage} className="text-[11px] text-muted hover:text-text hover:underline">관리</button>
        </div>
      </div>

      {loading && lists.length === 0 && (
        <div className="text-[11px] text-muted text-center py-3">불러오는 중…</div>
      )}

      {!loading && lists.length === 0 && (
        <div className="text-[11px] text-muted py-4 text-center border border-dashed border-border rounded-lg">
          저장된 리스트가 없습니다. <button onClick={onQuickAdd} className="text-brand hover:underline">새 리스트 만들기</button>
        </div>
      )}

      {lists.length > 0 && (
        <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5 no-scrollbar">
          {lists.map((l) => {
            const active = selected.includes(l.slug);
            return (
              <button
                key={l.slug}
                onClick={() => toggle(l.slug)}
                className={`w-full text-left rounded-lg border px-3 py-2 transition flex items-center gap-2.5 ${
                  active ? "border-brand bg-brand/5" : "border-border hover:border-brand/40"
                }`}
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${
                  active ? "bg-brand border-brand text-white" : "border-border"
                }`}>
                  {active ? "✓" : ""}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-text/90 font-medium truncate">{l.name}</span>
                  {l.description && <span className="block text-[10px] text-muted truncate">{l.description}</span>}
                </span>
                <span className="text-[11px] text-muted shrink-0 tabular-nums">{l.memberCount}명</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
