"use client";

import { useEffect, useMemo, useState } from "react";
import RecipientInput from "./RecipientInput";
import { mergeMembers as mergeWithFill, type Recipient } from "@/lib/recipients";
import { formatKst, ZONE_LABEL } from "@/lib/kst";

/** Merge extra into base, deduped by email (base wins, first name preserved). */
function mergeMembers(base: Recipient[], extra: Recipient[]): Recipient[] {
  return mergeWithFill(base, extra).members;
}

type ScheduleUse = { id: string; scheduledAt: string; templateTitle?: string; templateName: string; canManage: boolean };

/**
 * List create/edit modal.
 * Permissions: the creator and admins can edit everything; everyone else can only 'add' members (existing members are read-only).
 * If scheduled sends use this list, make the user choose cancel / keep / update the schedule too before saving. Reused by both ListSelectDialog (per-row edit) and SendForm (create list).
 * Member input is unified on RecipientInput (grid paste + CSV).
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
  /** Called after save/delete. On new creation, passes the created slug so the caller can select it immediately. */
  onSaved: (created?: { slug: string }) => void;
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
  const [originalEmails, setOriginalEmails] = useState<Set<string>>(new Set());
  const [scheduleAsk, setScheduleAsk] = useState<ScheduleUse[] | null>(null);

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
          setOriginalEmails(new Set((j.list.members ?? []).map((m: Recipient) => m.email.toLowerCase())));
          setCreatedBy(j.list.createdBy ?? "");
        }
      })
      .finally(() => setLoaded(true));
  }, [slug]);

  // anyone can create new; editing/deleting an existing list is creator or admin only (matches server canManage).
  const canManageList = !slug || (!!me && (me.toLowerCase() === createdBy.toLowerCase() || isAdmin));
  const canDelete = !!slug && canManageList;
  /** Not the owner: may only append members. */
  const addOnly = !!slug && !canManageList;
  const isOriginal = (email: string) => originalEmails.has(email.toLowerCase());

  function addMembers(rows: Recipient[]) {
    setMembers((cur) => mergeMembers(cur, rows));
  }

  // final members actually saved = confirmed members + unconfirmed (pending paste) rows.
  // prevents saving an empty list even if the "Add" button wasn't pressed.
  const finalMembers = useMemo(() => mergeMembers(members, pendingRows), [members, pendingRows]);
  const pendingExtra = finalMembers.length - members.length;

  // Show the company/title columns only when at least one member has a value from a CSV import (most lists lack these fields, so hidden by default).
  const hasCompanyCol = useMemo(() => members.some((m) => m.company?.trim()), [members]);
  const hasTitleCol = useMemo(() => members.some((m) => m.title?.trim()), [members]);

  function removeMember(email: string) {
    setMembers((cur) => cur.filter((m) => m.email !== email));
  }

  function commitNameEdit() {
    if (editingEmail === null) return;
    const email = editingEmail;
    const name = editingName.trim();
    setMembers((cur) => cur.map((m) => (m.email === email ? { ...m, name: name || undefined } : m)));
    setEditingEmail(null);
    setEditingName("");
  }

  /** Save button: if pending schedules use this list, ask first. */
  async function requestSave() {
    setErr("");
    if (slug) {
      const j = await fetch(`/api/schedules?list=${encodeURIComponent(slug)}`).then((r) => r.json()).catch(() => null);
      // Only schedules this user can actually update — asking about others' would offer a choice that changes nothing.
      const uses: ScheduleUse[] = (j?.schedules ?? []).filter((s: ScheduleUse) => s.canManage);
      if (uses.length > 0) { setScheduleAsk(uses); return; }
    }
    await save(false);
  }

  async function save(updateSchedules: boolean) {
    setErr(""); setSaving(true);
    try {
      let created: { slug: string } | undefined;
      if (slug && addOnly) {
        const newRows = finalMembers.filter((m) => !isOriginal(m.email));
        if (newRows.length > 0) {
          const r = await fetch(`/api/lists/${encodeURIComponent(slug)}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ members: newRows }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "추가 실패");
        }
      } else if (slug) {
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
        if (j.list?.slug) created = { slug: j.list.slug };
      }
      if (slug && updateSchedules && scheduleAsk) {
        const errors: string[] = [];
        for (const s of scheduleAsk) {
          const r = await fetch(`/api/sends/${encodeURIComponent(s.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshList: slug }),
          });
          if (!r.ok) errors.push((await r.json().catch(() => ({}))).error ?? "예약 갱신 실패");
        }
        if (errors.length) { setScheduleAsk(null); throw new Error(`리스트 저장 완료 · 예약 업데이트 실패: ${errors.join(", ")}`); }
      }
      setScheduleAsk(null);
      onSaved(created);
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
              {addOnly && (
                <div className="text-[12px] text-amber-700 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2">
                  멤버 추가만 가능 · 수정·삭제는 만든 사람({createdBy})·관리자
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-muted mb-1">이름 <span className="text-brand">*</span></label>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hensen VC 명단" disabled={addOnly} />
                </div>
                <div>
                  <label className="block text-[11px] text-muted mb-1">설명</label>
                  <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="2026 Series A 컨택" disabled={addOnly} />
                </div>
              </div>

              {(
              <div>
                <RecipientInput label="멤버 추가" onAdd={addMembers} onChange={setPendingRows} />
                {pendingExtra > 0 && (
                  <div className="mt-1.5 text-[11px] text-brand">
                    입력 중인 {pendingExtra}명도 저장 시 자동 포함됩니다 (칸 밖을 클릭하면 즉시 아래 목록에 반영).
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
                          // Non-owners can only touch rows they are adding right now.
                          const readOnly = addOnly && isOriginal(m.email);
                          return (
                          <tr key={m.email} className={`border-b border-border last:border-b-0 ${addOnly && !readOnly ? "bg-brand/[0.06]" : nameless && !readOnly ? "bg-amber-500/[0.06]" : ""}`}>
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
                            {hasCompanyCol && <td className="px-3 py-1.5 text-muted">{m.company ?? ""}</td>}
                            {hasTitleCol && <td className="px-3 py-1.5 text-muted">{m.title ?? ""}</td>}
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
                <button onClick={onClose} className="btn-ghost text-sm">취소</button>
                <button onClick={requestSave} disabled={saving || (addOnly && finalMembers.length === originalEmails.size)} className="btn-primary text-sm">
                  {saving ? "저장 중…"
                    : addOnly ? `${finalMembers.length - originalEmails.size}명 추가`
                    : slug ? `저장 (${finalMembers.length}명)` : `리스트 생성 (${finalMembers.length}명)`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {scheduleAsk && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setScheduleAsk(null); }}>
          <div className="card w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">리스트를 사용하는 예약 {scheduleAsk.length}건</h3>
            <ul className="text-[13px] space-y-1 max-h-40 overflow-y-auto">
              {scheduleAsk.map((s) => (
                <li key={s.id} className="flex justify-between gap-3">
                  <span className="truncate">{s.templateTitle ?? s.templateName}</span>
                  <span className="text-muted shrink-0 tabular-nums">{formatKst(s.scheduledAt)} {ZONE_LABEL}</span>
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-text/80">예약된 발송의 수신자도 함께 업데이트하시겠습니까?</p>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost text-sm" onClick={() => setScheduleAsk(null)} title="저장 없이 편집으로 복귀">취소</button>
              <button className="btn-ghost text-sm" disabled={saving} onClick={() => save(false)} title="리스트만 저장 · 예약은 기존 명단">리스트만 수정</button>
              <button className="btn-primary text-sm" disabled={saving} onClick={() => save(true)} title="리스트 저장 + 예약 명단 업데이트">확인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
