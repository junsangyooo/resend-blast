"use client";

import { useCallback, useEffect, useState } from "react";
import KstDateTimeInput, { type KstValue } from "./KstDateTimeInput";
import { formatKst, relativeFromNow, toKstParts, kstInputToDate, ZONE_LABEL } from "@/lib/kst";
import { SEND_STATUS_LABEL, RECIPIENT_STATUS_LABEL, isIntentionalSkip } from "@/lib/status-text";
import type { FollowupPayload } from "./TrackingSidebar";

type Schedule = {
  id: string;
  createdAt: string;
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
  status: string;
  sentBy: string;
  templateName: string;
  templateTitle?: string;
  subject: string;
  from: string;
  replyTo?: string;
  isAd?: boolean;
  listSlugs: string[];
  excludeListSlugs?: string[];
  recipientCount: number;
  summary: { total: number; sent: number; failed: number; skipped?: number };
  problem?: string;
  problemAcknowledged?: boolean;
  canceledBy?: string;
  canManage: boolean;
};

type Recipient = { email: string; name?: string; listSlug?: string | null; status: string; error?: string };

const STATUS_CLS: Record<string, string> = {
  scheduled: "border-brand/40 text-brand",
  due: "border-yellow-500/50 text-yellow-600",
  running: "border-yellow-500/50 text-yellow-600",
  completed: "border-green-500/50 text-green-600",
  partial: "border-amber-500/60 text-amber-600",
  aborted: "border-orange-500/50 text-orange-600",
  canceled: "border-border text-muted",
  missed: "border-red-500/60 text-red-600",
  failed: "border-red-500/60 text-red-600",
};
const RECIPIENT_CLS: Record<string, string> = {
  pending: "text-muted", sent: "text-green-600", failed: "text-red-600", skipped: "text-amber-600",
};

function statusKey(s: Schedule, now: number = Date.now()): string {
  // Due but not yet picked up (the runner checks every 15 s).
  if (s.status === "scheduled" && new Date(s.scheduledAt).getTime() <= now) return "due";
  if (s.status === "completed" && (s.problem || (s.summary.skipped ?? 0) > 0 || s.summary.failed > 0)) return "partial";
  return s.status;
}

/**
 * Scheduled send management: upcoming schedules (change time, cancel, remove recipients) and results of past ones (30 days).
 * Not-run, over-limit and failed items show as red rows right away; expanding one shows per-recipient status.
 */
export default function ScheduledSends({ active, onChanged, onFollowup }: {
  active: boolean;
  onChanged?: () => void;
  /** Re-fill the send screen with the people a schedule did not reach. */
  onFollowup?: (p: FollowupPayload) => void;
}) {
  const [rows, setRows] = useState<Schedule[]>([]);
  const [schedulerRunning, setSchedulerRunning] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Recipient[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: KstValue } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await fetch("/api/schedules").then((r) => r.json());
      setRows(j.schedules ?? []);
      setSchedulerRunning(j.schedulerRunning !== false);
      setNow(Date.now());
    } catch {
      setErr("예약 목록을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const j = await fetch(`/api/sends/${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => null);
    setDetail(j?.send?.recipients ?? []);
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
    const t = setInterval(() => { load(); if (open) loadDetail(open); }, 15_000);
    return () => clearInterval(t);
  }, [active, load, loadDetail, open]);

  async function patch(id: string, body: object): Promise<boolean> {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/sends/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "실패");
      await load();
      if (open === id) await loadDetail(id);
      onChanged?.();
      return true;
    } catch (e: any) {
      setErr(e?.message ?? "실패");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** People the schedule never reached (missed / failed to start / over the limit) — not unsubscribed or removed ones. */
  async function refillUnsent(s: Schedule) {
    const j = await fetch(`/api/sends/${encodeURIComponent(s.id)}`).then((r) => r.json()).catch(() => null);
    const rs: Recipient[] = j?.send?.recipients ?? [];
    const targets = rs
      .filter((r) => r.status === "pending" || (r.status === "skipped" && !isIntentionalSkip(r.error)))
      .map((r) => ({ email: r.email, name: r.name }));
    if (targets.length === 0) { setErr("다시 보낼 대상이 없습니다"); return; }
    onFollowup?.({ recipients: targets, sourceSendId: s.id, templateName: s.templateName, isAd: s.isAd, from: s.from, replyTo: s.replyTo });
  }

  function toggle(id: string) {
    if (open === id) { setOpen(null); setDetail(null); return; }
    setOpen(id); setDetail(null); loadDetail(id);
  }

  async function saveTime() {
    if (!editing) return;
    const at = kstInputToDate(editing.value.date, editing.value.time);
    if (!at) { setErr("날짜와 시간을 확인하세요"); return; }
    if (await patch(editing.id, { scheduledAt: at.toISOString() })) setEditing(null);
  }

  const upcoming = rows.filter((r) => r.status === "scheduled");
  const past = rows.filter((r) => r.status !== "scheduled");

  const renderRow = (s: Schedule) => {
    const key = statusKey(s, now);
    const meta = { label: SEND_STATUS_LABEL[key] ?? s.status, cls: STATUS_CLS[key] ?? "border-border text-muted" };
    const isOpen = open === s.id;
    const problem = s.problem && !s.problemAcknowledged;
    const isPending = s.status === "scheduled";
    return (
      <div key={s.id} className={`rounded-xl border ${problem ? "border-red-400/60 bg-red-500/[0.04]" : "border-border"}`}>
        <div className="p-3 space-y-1.5">
          <div className="flex items-start gap-2">
            <span className={`chip shrink-0 ${meta.cls}`}>{meta.label}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold tabular-nums">
                {formatKst(s.scheduledAt)} <span className="text-muted font-normal">{ZONE_LABEL}</span>
                {s.status !== "canceled" && <span className="text-[12px] text-muted font-normal"> · {relativeFromNow(s.scheduledAt, now)}</span>}
              </div>
              <div className="text-[13px] text-text/80 truncate" title={s.subject}>{s.templateTitle ?? s.templateName} · {s.subject}</div>
              <div className="text-[12px] text-muted">
                예약자 {s.sentBy.split("@")[0]}
                {isPending ? null : (
                  // Always add up to the total: whatever was neither sent nor failed is 미발송.
                  <> · 발송 {s.summary.sent}{s.summary.failed > 0 && <> · 실패 {s.summary.failed}</>}
                    {s.recipientCount - s.summary.sent - s.summary.failed > 0 && <> · 미발송 {s.recipientCount - s.summary.sent - s.summary.failed}</>}
                    {" "}/ 총 {s.recipientCount}</>
                )}
                {s.canceledBy && <> · 취소자 {s.canceledBy.split("@")[0]}</>}
              </div>
            </div>
            {isPending && s.canManage && (
              <div className="flex items-center gap-1 shrink-0">
                <button className="btn-ghost text-xs" disabled={busy} onClick={() => setEditing({ id: s.id, value: toKstParts(new Date(s.scheduledAt)) })}>시간 변경</button>
                <button className="btn-ghost text-xs hover:text-red-600" disabled={busy} onClick={() => setConfirmCancel(s.id)}>예약 취소</button>
              </div>
            )}
          </div>

          {problem && (
            <div className="flex items-center gap-2 text-[12px] text-red-600 bg-red-500/10 border border-red-500/30 rounded-lg px-2.5 py-1.5">
              <span className="flex-1">{s.problem}</span>
              {s.canManage && <button className="underline shrink-0" disabled={busy} onClick={() => patch(s.id, { acknowledge: true })}>알림 닫기</button>}
            </div>
          )}

          {editing?.id === s.id && (
            <div className="rounded-lg border border-border bg-surface2/40 p-2.5 space-y-2">
              <KstDateTimeInput value={editing.value} onChange={(v) => setEditing({ id: s.id, value: v })} />
              <div className="flex justify-end gap-2">
                <button className="btn-ghost text-xs" onClick={() => setEditing(null)}>취소</button>
                <button className="btn-primary text-xs" disabled={busy} onClick={saveTime}>이 시간으로 변경</button>
              </div>
            </div>
          )}

          {confirmCancel === s.id && (
            <div className="flex items-center justify-end gap-2 text-[12px]">
              <span className="text-red-600 mr-auto">예약 취소 · 전원 미발송</span>
              <button className="btn-ghost text-xs" onClick={() => setConfirmCancel(null)}>닫기</button>
              <button className="btn text-xs bg-red-600 text-white" disabled={busy} onClick={async () => { if (await patch(s.id, { cancel: true })) setConfirmCancel(null); }}>예약 취소</button>
            </div>
          )}

          {isPending && !s.canManage && (
            <div className="text-[12px] text-muted">🔒 예약자·관리자만 변경 가능</div>
          )}
          <div className="flex items-center gap-4">
            <button className="text-[12px] text-brand hover:underline" onClick={() => toggle(s.id)}>
              {isOpen ? "수신자 접기 ▴" : `수신자 ${s.recipientCount}명 ▾`}
            </button>
            {onFollowup && (key === "missed" || key === "failed" || key === "partial" || key === "aborted") && (
              <button
                className="text-[12px] text-brand hover:underline"
                title="미발송자만 발송 화면에 채움 (현재 이메일 내용으로 발송)"
                onClick={() => refillUnsent(s)}
              >미발송자 다시 보내기 →</button>
            )}
          </div>
        </div>

        {isOpen && (
          <div className="border-t border-border max-h-72 overflow-y-auto">
            {detail === null ? (
              <div className="p-3 text-[12px] text-muted">불러오는 중…</div>
            ) : (
              <table className="w-full text-[12px]">
                <tbody>
                  {detail.map((r) => {
                    // A finished send has no "waiting" people — anyone still pending simply never got it.
                    const shown = r.status === "pending" && !isPending ? "skipped" : r.status;
                    const st = { label: RECIPIENT_STATUS_LABEL[shown] ?? shown, cls: RECIPIENT_CLS[shown] ?? "text-muted" };
                    if (confirmRemove === `${s.id}|${r.email}`) {
                      return (
                        <tr key={r.email} className="bg-red-500/[0.06] border-b border-border/60">
                          <td className="px-3 py-1.5 font-mono text-text/90 truncate max-w-[220px]">{r.email}</td>
                          <td colSpan={3} className="px-2 py-1.5 text-right whitespace-nowrap">
                            <span className="text-red-600 mr-2">이번 예약에서 제외</span>
                            <button className="btn-ghost text-xs py-0.5" onClick={() => setConfirmRemove(null)}>취소</button>{" "}
                            <button className="btn text-xs py-0.5 bg-red-600 text-white" disabled={busy}
                              onClick={async () => { if (await patch(s.id, { removeRecipient: r.email })) setConfirmRemove(null); }}>제외</button>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={r.email} className="border-b border-border/60 last:border-b-0">
                        <td className="px-3 py-1.5 font-mono text-text/90 truncate max-w-[220px]">{r.email}</td>
                        <td className="px-2 py-1.5 text-muted truncate max-w-[120px]">{r.name ?? ""}</td>
                        <td className={`px-2 py-1.5 whitespace-nowrap ${st.cls}`} title={r.error}>
                          {st.label}{r.error && r.status !== "sent" ? <span className="text-muted"> · {r.error}</span> : null}
                        </td>
                        <td className="px-2 py-1.5 text-right w-8">
                          {isPending && s.canManage && (
                            <button className="text-muted hover:text-red-500" title="이번 예약에서 제외" disabled={busy}
                              onClick={() => setConfirmRemove(`${s.id}|${r.email}`)}>✕</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-5 space-y-4">
      <div className="text-[12px] text-muted rounded-lg border border-border bg-surface2/40 px-3 py-2">
        {ZONE_LABEL} 기준 · 예약 시점 내용·명단으로 발송 · 수신거부·발송 한도는 발송 시점 기준 ·{" "}
        <b className="text-red-600">서버 중단 시각의 예약은 미실행</b> · 서버 재시작 시 이후 예약 자동 재개
      </div>
      {!schedulerRunning && (
        <div className="text-[12px] text-red-600 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          예약 실행기 중단 · 예약 미발송 상태 · 관리자 확인 필요
        </div>
      )}
      {err && <div className="text-[12px] text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2">{err}</div>}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">예정 <span className="text-muted font-normal">{upcoming.length}건</span></h3>
        {upcoming.length === 0 ? (
          <div className="text-[12px] text-muted text-center py-6 border border-dashed border-border rounded-xl">
            {loading ? "불러오는 중…" : "예정된 예약 없음"}
          </div>
        ) : upcoming.map(renderRow)}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">지난 예약 <span className="text-muted font-normal">최근 30일 · {past.length}건</span></h3>
        {past.length === 0 ? (
          <div className="text-[12px] text-muted text-center py-6 border border-dashed border-border rounded-xl">지난 예약 없음</div>
        ) : past.map(renderRow)}
      </section>
    </div>
  );
}
