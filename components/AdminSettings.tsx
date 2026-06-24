"use client";

import { useEffect, useState } from "react";
import { useEscClose } from "./hooks";
import { brand } from "@/brand.config";

type Sender = { value: string; label: string; builtin?: boolean; scope?: "shared" | "personal"; owner?: string };
type Suppression = { email: string; reason: string; at: string; source?: string };
type AdminEntry = { email: string; seed: boolean };

const REASON_LABEL: Record<string, string> = {
  unsubscribe: "수신거부", bounced: "반송", complained: "스팸신고", manual: "수동",
};

type Tab = "suppression" | "senders" | "admins";

/**
 * Settings — unsubscribe/bounce (everyone) + sender management (admin) + admin management (admin).
 * The sender/admin tabs are shown locked to non-admins and cannot be selected.
 * The server enforces permissions, so this UI is for convenience.
 */
export default function AdminSettings({
  open, isAdmin = false, onClose, onChanged,
}: {
  open: boolean;
  isAdmin?: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("suppression");
  const [senders, setSenders] = useState<Sender[]>([]);
  const [supps, setSupps] = useState<Suppression[]>([]);
  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [newAdmin, setNewAdmin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockPopup, setLockPopup] = useState<string | null>(null); // popup that briefly appears when a locked tab is clicked

  useEscClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    setErr("");
    setTab("suppression");
    refresh();
    // isAdmin may arrive after the /api/config response, so include it in deps — refetch even if it becomes true late.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isAdmin]);

  async function refresh() {
    const [s, u, a] = await Promise.all([
      // admins fetch everything including personal — must be able to clean up legacy/other users' personal entries too.
      fetch(isAdmin ? "/api/from?all=1" : "/api/from").then((r) => r.json()).catch(() => ({ senders: [] })),
      fetch("/api/suppression").then((r) => r.json()).catch(() => ({ suppressions: [] })),
      isAdmin ? fetch("/api/admins").then((r) => r.json()).catch(() => ({ admins: [] })) : Promise.resolve({ admins: [] }),
    ]);
    setSenders(s.senders ?? []);
    setSupps(u.suppressions ?? []);
    setAdmins(a.admins ?? []);
  }

  function showLockPopup(which: string) {
    setLockPopup(which);
    setTimeout(() => setLockPopup((cur) => (cur === which ? null : cur)), 1800);
  }

  async function addSharedSender() {
    setErr(""); setBusy(true);
    try {
      const dn = displayName.trim();
      const em = email.trim();
      // the name is the sender shown in the recipient's mailbox. Composed internally as "name <address>".
      const value = dn ? `${dn} <${em}>` : em;
      const r = await fetch("/api/from", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, label: dn || em, scope: "shared" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "추가 실패");
      setDisplayName(""); setEmail("");
      await refresh();
      onChanged?.();
    } catch (e: any) { setErr(e?.message ?? "추가 실패"); }
    finally { setBusy(false); }
  }

  async function removeSender(v: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/from?value=${encodeURIComponent(v)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "삭제 실패");
      await refresh();
      onChanged?.();
    } catch (e: any) { setErr(e?.message ?? "삭제 실패"); }
    finally { setBusy(false); }
  }

  async function unsuppress(email: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/suppression?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "해제 실패");
      await refresh();
    } catch (e: any) { setErr(e?.message ?? "해제 실패"); }
    finally { setBusy(false); }
  }

  async function addAdmin() {
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/admins", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newAdmin.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "추가 실패");
      setNewAdmin("");
      await refresh();
    } catch (e: any) { setErr(e?.message ?? "추가 실패"); }
    finally { setBusy(false); }
  }

  async function removeAdmin(target: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/admins?email=${encodeURIComponent(target)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "삭제 실패");
      await refresh();
    } catch (e: any) { setErr(e?.message ?? "삭제 실패"); }
    finally { setBusy(false); }
  }

  if (!open) return null;

  // the settings tab manages shared senders (personal nicknames are set by each user on the send screen).
  const sharedSenders = senders.filter((s) => s.builtin || s.scope !== "personal");
  // personal sender list visible only to admins — for cleaning up wrongly registered entries.
  const personalSenders = senders.filter((s) => !s.builtin && s.scope === "personal");

  const lockedTabBtn = (key: Tab, label: string) => (
    <div className="relative">
      <button
        onClick={() => showLockPopup(key)}
        aria-disabled
        className="text-xs px-3 py-1.5 rounded-lg text-muted/50 cursor-not-allowed flex items-center gap-1.5"
      >
        {label} <LockIcon />
      </button>
      {lockPopup === key && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-10 text-[11px] bg-bg border border-border rounded-lg px-2.5 py-1.5 whitespace-nowrap text-muted shadow">
          관리자 권한이 필요합니다
        </div>
      )}
    </div>
  );
  const tabBtn = (key: Tab, label: string) => (
    <button
      onClick={() => setTab(key)}
      className={`text-xs px-3 py-1.5 rounded-lg ${tab === key ? "bg-brand/10 text-brand border border-brand/30" : "text-muted hover:text-text"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <div className="kicker">Settings</div>
            <h2 className="mt-0.5 text-base font-semibold">설정</h2>
          </div>
          <button onClick={onClose} className="icon-btn" title="닫기">✕</button>
        </div>

        <div className="px-5 pt-3 flex gap-2 shrink-0">
          {tabBtn("suppression", `수신거부/반송 (${supps.length})`)}
          {isAdmin ? tabBtn("senders", `발신자 관리 (${sharedSenders.length})`) : lockedTabBtn("senders", "발신자 관리")}
          {isAdmin ? tabBtn("admins", `관리자 (${admins.length})`) : lockedTabBtn("admins", "관리자")}
        </div>

        {err && <div className="mx-5 mt-3 text-[12px] text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2">{err}</div>}

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {tab === "suppression" && (
            <>
              <p className="text-[11px] text-muted">수신거부·반송·스팸신고된 주소는 다음 발송에서 자동 제외됩니다.{isAdmin ? " 오등록이면 해제하세요." : ""}</p>
              {supps.length === 0 ? (
                <div className="text-xs text-muted text-center py-10 border border-dashed border-border rounded-xl">억제된 주소가 없습니다.</div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead className="bg-surface2/50 text-[10px] text-muted"><tr><th className="px-3 py-1.5 text-left">이메일</th><th className="px-3 py-1.5 text-left">사유</th><th className="px-3 py-1.5 text-right"></th></tr></thead>
                    <tbody>
                      {supps.map((s) => (
                        <tr key={s.email} className="border-t border-border">
                          <td className="px-3 py-1.5 font-mono text-text/90 truncate">{s.email}</td>
                          <td className="px-3 py-1.5 text-muted">{REASON_LABEL[s.reason] ?? s.reason}</td>
                          <td className="px-3 py-1.5 text-right">
                            {isAdmin && <button onClick={() => unsuppress(s.email)} disabled={busy} className="text-[11px] text-muted hover:text-brand">해제</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === "senders" && isAdmin && (
            <>
              <div className="card p-3 space-y-2 bg-surface2/30">
                <div className="text-[11px] text-muted">공용 이메일 추가 (@{brand.auth.senderDomain})</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-muted mb-0.5">이름 (수신자가 확인 가능)</label>
                    <input className="input py-1.5 text-[12px]" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="예: RLWRLD Events" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted mb-0.5">이메일 주소</label>
                    <input className="input py-1.5 text-[12px] font-mono" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`events@${brand.auth.senderDomain}`} />
                  </div>
                </div>
                <div className="flex items-center justify-end">
                  <button onClick={addSharedSender} disabled={busy || !email.trim()} className="btn-primary text-xs">추가</button>
                </div>
              </div>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-[12px]">
                  <tbody>
                    {sharedSenders.map((s) => (
                      <tr key={s.value} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2"><div className="text-text/90">{s.label}</div><div className="font-mono text-[11px] text-muted truncate">{s.value}</div></td>
                        <td className="px-3 py-2 text-right">
                          {s.builtin ? <span className="chip text-muted">내장</span> : (
                            <button onClick={() => removeSender(s.value)} disabled={busy} className="text-[11px] text-muted hover:text-red-500">삭제</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted">개인 발신 이름(본인 계정)은 발송 화면의 발신자 선택에서 직접 설정합니다.</p>

              {personalSenders.length > 0 && (
                <>
                  <div className="text-[11px] text-muted mt-4">개인 발신자 (각 소유자에게만 노출 — 정리용)</div>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-[12px]">
                      <tbody>
                        {personalSenders.map((s) => (
                          <tr key={s.value} className="border-b border-border last:border-b-0">
                            <td className="px-3 py-2">
                              <div className="text-text/90">{s.label}</div>
                              <div className="font-mono text-[11px] text-muted truncate">{s.value}</div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button onClick={() => removeSender(s.value)} disabled={busy} className="text-[11px] text-muted hover:text-red-500">삭제</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {tab === "admins" && isAdmin && (
            <>
              <div className="card p-3 space-y-2 bg-surface2/30">
                <div className="text-[11px] text-muted">관리자 추가 (@{brand.auth.loginDomain})</div>
                <div className="flex gap-2">
                  <input className="input py-1.5 text-[12px] font-mono flex-1" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} placeholder={`name@${brand.auth.loginDomain}`} />
                  <button onClick={addAdmin} disabled={busy || !newAdmin.trim()} className="btn-primary text-xs shrink-0">추가</button>
                </div>
                <p className="text-[10px] text-muted">관리자는 공용 발신자·수신거부 해제·관리자 관리, 그리고 모든 리스트/이메일 편집 권한을 갖습니다.</p>
              </div>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-[12px]">
                  <tbody>
                    {admins.map((a) => (
                      <tr key={a.email} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2 font-mono text-text/90">{a.email}</td>
                        <td className="px-3 py-2 text-right">
                          {a.seed ? <span className="chip text-muted" title="환경설정(ADMIN_EMAILS)에 고정된 관리자 — 삭제 불가">고정</span> : (
                            <button onClick={() => removeAdmin(a.email)} disabled={busy} className="text-[11px] text-muted hover:text-red-500">삭제</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
