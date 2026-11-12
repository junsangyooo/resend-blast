"use client";

import { useState } from "react";
import { useEscClose } from "./hooks";
import type { Recipient } from "@/lib/recipients";

/**
 * Save directly-entered recipients as a reusable list (one click, name prefilled).
 * On success the caller selects the new list and clears the ad-hoc text, so the recipients stay the same.
 */
export default function SaveAsListDialog({ rows, defaultName, onSaved, onClose }: {
  rows: Recipient[];
  defaultName: string;
  onSaved: (slug: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  useEscClose(true, onClose);

  async function save() {
    if (!name.trim()) { setErr("리스트 이름을 입력하세요"); return; }
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/lists", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: "직접 입력에서 저장", members: rows }),
      });
      const j = await r.json();
      if (!r.ok || !j.list?.slug) throw new Error(j.error ?? "저장 실패");
      onSaved(j.list.slug);
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">{rows.length}명을 리스트로 저장</h3>
        <p className="text-[13px] text-muted">다음부터는 붙여넣지 않고 리스트에서 고르면 됩니다. 저장하면 직접 입력 칸 대신 이 리스트가 선택돼요.</p>
        <input
          autoFocus
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) save(); }}
          placeholder="리스트 이름"
        />
        {err && <div className="text-[12px] text-red-500">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost text-sm" onClick={onClose}>취소</button>
          <button className="btn-primary text-sm" disabled={saving} onClick={save}>{saving ? "저장 중…" : "리스트로 저장"}</button>
        </div>
      </div>
    </div>
  );
}
