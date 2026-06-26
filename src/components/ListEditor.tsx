"use client";

import { useEffect, useMemo, useState } from "react";
import RecipientInput from "./RecipientInput";
import { type Recipient } from "@/lib/recipients";

/** Merge extra into base, deduped by email (base wins, first name preserved). */
function mergeMembers(base: Recipient[], extra: Recipient[]): Recipient[] {
  const seen = new Set(base.map((m) => m.email.toLowerCase()));
  const out = [...base];
  for (const r of extra) {
    const e = r.email.toLowerCase();
    if (!seen.has(e)) { seen.add(e); out.push({ email: e, name: r.name }); }
  }
  return out;
}

/**
 * List create/edit modal. Reused by both ListManager (management screen) and SendForm (inline quick add).
 * Member input is unified through RecipientInput (grid paste + CSV).
 */
export default function ListEditor({
  slug,
  me,
  isAdmin = false,
  onClose,
  onSaved,
}: {
  slug: string | null; // null = new creation
  me: string | null;
  isAdmin?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<Recipient[]>([]);
  const [pendingRows, setPendingRows] = useState<Recipient[]>([]); // rows pasted but not yet "added"
  const [createdBy, setCreatedBy] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // inline member name editing
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  useEffect(() => {
    if (!slug) { setLoaded(true); return; }
    setLoaded(false);
    fetch(`/api/lists/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.list) {
          setName(j.list.name);
          setDescription(j.list.description ?? "");
          setMembers(j.list.members ?? []);
          setCreatedBy(j.list.createdBy ?? "");
        }
      })
      .finally(() => setLoaded(true));
  }, [slug]);

  // anyone can create new; editing/deleting an existing list is creator or admin only (matches server canManage).
  const canManageList = !slug || (!!me && (me.toLowerCase() === createdBy.toLowerCase() || isAdmin));
  const canDelete = !!slug && canManageList;
  const readOnly = !!slug && !canManageList;

  function addMembers(rows: Recipient[]) {
    setMembers((cur) => mergeMembers(cur, rows));
  }

  // final members actually saved = confirmed members + unconfirmed (pending paste) rows.
  // prevents saving an empty list even if the "Add" button wasn't pressed.
  const finalMembers = useMemo(() => mergeMembers(members, pendingRows), [members, pendingRows]);
  const pendingExtra = finalMembers.length - members.length;

  function removeMember(email: string) {
    setMembers((cur) => cur.filter((m) => m.email !== email));
  }

  function commitNameEdit() {
    if (editingEmail === null) return;
    const email = editingEmail;
    const name = editingName.trim();
    setMembers((cur) => cur.map((m) => (m.email === email ? { email: m.email, name: name || undefined } : m)));
    setEditingEmail(null);
    setEditingName("");
  }

  async function save() {
    setErr(""); setSaving(true);
    try {
      if (slug) {
        const r = await fetch(`/api/lists/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description, members: finalMembers }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "저장 실패");
      } else {
        if (!name.trim()) { setErr("리스트 이름을 입력하세요"); setSaving(false); return; }
        const r = await fetch("/api/lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description, members: finalMembers }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "생성 실패");
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!slug) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/lists/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "삭제 실패");
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[55] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl h-[86vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <div className="kicker">{slug ? "Edit List" : "New List"}</div>
            <h2 className="mt-0.5 text-base font-semibold truncate">{slug ? name || slug : "새 리스트"}</h2>
          </div>
          <button onClick={onClose} className="icon-btn">✕</button>
        </div>

        {!loaded ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted">불러오는 중…</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {readOnly && (
                <div className="text-[12px] text-amber-700 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2">
                  읽기 전용 — 이 리스트는 생성자({createdBy}) 또는 관리자만 수정할 수 있습니다.
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-muted mb-1">이름 <span className="text-brand">*</span></label>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hensen VC 명단" disabled={readOnly} />
                </div>
                <div>
                  <label className="block text-[11px] text-muted mb-1">설명</label>
                  <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="2026 Series A 컨택" disabled={readOnly} />
                </div>
              </div>

              {!readOnly && (
              <div>
                <RecipientInput label="멤버 추가" onAdd={addMembers} onChange={setPendingRows} />
                {pendingExtra > 0 && (
                  <div className="mt-1.5 text-[11px] text-brand">
                    붙여넣은 {pendingExtra}명이 저장 시 자동 포함됩니다. (‘추가’를 누르면 아래 목록에 미리 반영)
                  </div>
                )}
              </div>
              )}

              {members.length > 0 && (
                <div>
                  <div className="text-[11px] text-muted mb-1.5">현재 멤버 ({members.length}명)</div>
                  <div className="rounded-lg border border-border bg-surface max-h-56 overflow-y-auto">
                    <table className="w-full text-[12px]">
                      <tbody>
                        {members.map((m) => {
                          const nameless = !m.name?.trim();
                          const editing = editingEmail === m.email;
                          return (
                          <tr key={m.email} className={`border-b border-border last:border-b-0 ${nameless && !readOnly ? "bg-amber-500/[0.06]" : ""}`}>
                            <td className="px-3 py-1.5 text-text/90 font-mono">{m.email}</td>
                            <td className="px-3 py-1.5 text-muted">
                              {readOnly ? (m.name ?? "") : editing ? (
                                <input
                                  autoFocus
                                  className="input text-[12px] py-0.5 px-1.5 w-full max-w-[160px]"
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  onBlur={commitNameEdit}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitNameEdit();
                                    if (e.key === "Escape") { setEditingEmail(null); setEditingName(""); }
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className={`text-left w-full hover:underline decoration-dotted ${nameless ? "text-amber-500/80" : ""}`}
                                  title="클릭해서 이름 수정"
                                  onClick={() => { setEditingEmail(m.email); setEditingName(m.name ?? ""); }}
                                >
                                  {m.name?.trim() || "+ 이름 추가"}
                                </button>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              {!readOnly && <button onClick={() => removeMember(m.email)} className="text-muted hover:text-red-500 text-[11px]">✕</button>}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {err && (
                <div className="text-[12px] text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2">{err}</div>
              )}

              {slug && (
                <div className="text-[10px] text-muted">
                  생성자: {createdBy} {!canDelete && me && "(삭제는 생성자만 가능)"}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0">
              <div>
                {slug && canDelete && (
                  confirmDelete ? (
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] text-red-500">정말 삭제?</span>
                      <button onClick={doDelete} disabled={busy} className="btn-ghost text-xs hover:text-red-500">
                        {busy ? "삭제 중…" : "삭제 확인"}
                      </button>
                      <button onClick={() => setConfirmDelete(false)} className="btn-ghost text-xs">취소</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)} className="text-[11px] text-muted hover:text-red-500">
                      🗑 리스트 삭제
                    </button>
                  )
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-ghost text-sm">{readOnly ? "닫기" : "취소"}</button>
                {!readOnly && (
                  <button onClick={save} disabled={saving} className="btn-primary text-sm">
                    {saving ? "저장 중…" : slug ? `저장 (${finalMembers.length}명)` : `리스트 생성 (${finalMembers.length}명)`}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
