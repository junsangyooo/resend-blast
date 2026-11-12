"use client";

import { formatKst, ZONE_LABEL } from "@/lib/kst";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StatusGuide from "./StatusGuide";
import { isUnreachedSkip } from "@/lib/status-text";

type SendMetrics = {
  total: number; sent: number; failed: number;
  delivered: number; opened: number; clicked: number; bounced: number; complained: number;
};

type SendSummary = {
  id: string;
  createdAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "aborted";
  sentBy: string;
  templateName: string;
  templateTitle?: string;
  kind?: "normal" | "test" | "followup";
  scheduledAt?: string;
  excludeListSlugs?: string[];
  subject: string;
  from: string;
  replyTo?: string;
  isAd?: boolean;
  listSlugs: string[];
  adhocCount: number;
  recipientCount: number;
  summary: { total: number; sent: number; failed: number };
  statusBreakdown?: StatusBreakdown;
};

type StatusBreakdown = { delivered: number; sent: number; bounced: number; failed: number; pending: number; skipped?: number };

/** Stage of a single recipient (mutually exclusive). Used for ordering within detail-modal groups. */
type Stage = "failed" | "bounced" | "skipped" | "pending" | "sent" | "delivered";
function stageOf(r: { status: string; liveStatus?: string }): Stage {
  if (r.status === "failed") return "failed";
  if (r.status === "skipped") return "skipped";
  if (r.status === "pending") return "pending";
  const ls = (r.liveStatus ?? "").toLowerCase();
  if (ls === "bounced" || ls === "complained") return "bounced";
  if (ls === "delivered" || ls === "opened" || ls === "clicked") return "delivered";
  return "sent";
}
// Stage sort order: problem (failed/bounced) → in progress (pending/sending) → done (delivered). Issues float to the top when tracking.
const STAGE_ORDER: Record<Stage, number> = { failed: 0, bounced: 1, skipped: 2, pending: 3, sent: 4, delivered: 5 };

/** Single source for per-stage label and color, shared by card dots, progress bar, group header chips and subheadings. */
const STAGE_META: Record<Stage, { label: string; bar: string; dot: string }> = {
  delivered: { label: "전달", bar: "bg-green-500", dot: "bg-green-500" },
  sent: { label: "전송중", bar: "bg-yellow-500", dot: "bg-yellow-500" },
  bounced: { label: "반송", bar: "bg-red-600", dot: "bg-red-600" },
  failed: { label: "실패", bar: "bg-gray-500", dot: "bg-gray-500" },
  skipped: { label: "미발송", bar: "bg-amber-400", dot: "bg-amber-400" },
  pending: { label: "대기", bar: "bg-gray-300", dot: "bg-gray-400" },
};
/** Display order (shared by dots, chips and bar segments): done → in progress → problem. */
const STAGE_VIEW: Stage[] = ["delivered", "sent", "bounced", "failed", "skipped", "pending"];

/** Aggregate the recipient array by stage (per stageOf, including complained; every screen uses the same definition). */
function stageCounts(rs: { status: string; liveStatus?: string }[]): Record<Stage, number> {
  const c: Record<Stage, number> = { delivered: 0, sent: 0, bounced: 0, failed: 0, skipped: 0, pending: 0 };
  for (const r of rs) c[stageOf(r)]++;
  return c;
}

type SendDetail = SendSummary & {
  recipients: {
    email: string;
    name?: string;
    listSlug?: string | null;
    resendId?: string;
    status: "pending" | "sent" | "failed" | "skipped";
    error?: string;
    liveStatus?: string;
    liveStatusAt?: string;
  }[];
};

/** Re-send prefill payload: recipients (with names) plus the original's ad flag/sender/reply-to, to keep compliance and consistency. */
export type FollowupPayload = {
  recipients: { email: string; name?: string }[];
  /** The send this follow-up comes from (recorded on the new send). */
  sourceSendId?: string;
  templateName: string;
  isAd?: boolean;
  from?: string;
  replyTo?: string;
};

const STATUS_META: Record<string, { color: string; label: string; dot: string }> = {
  delivered: { color: "text-green-600", label: "전달됨 · Delivered", dot: "bg-green-500" },
  sent: { color: "text-yellow-600", label: "전송중 · Sent", dot: "bg-yellow-500" },
  opened: { color: "text-blue-600", label: "열람 · Opened", dot: "bg-blue-500" },
  clicked: { color: "text-purple-600", label: "클릭 · Clicked", dot: "bg-purple-500" },
  bounced: { color: "text-red-600", label: "반송 · Bounced", dot: "bg-red-600" },
  failed: { color: "text-gray-500", label: "실패 · Failed", dot: "bg-gray-500" },
  skipped: { color: "text-amber-600", label: "미발송 · Skipped", dot: "bg-amber-400" },
  complained: { color: "text-orange-600", label: "스팸신고 · Complained", dot: "bg-orange-500" },
  delivery_delayed: { color: "text-gray-500", label: "지연 · Delayed", dot: "bg-gray-400" },
  queued: { color: "text-gray-500", label: "대기 · Queued", dot: "bg-gray-500" },
  pending: { color: "text-gray-500", label: "대기 · Pending", dot: "bg-gray-500" },
  unknown: { color: "text-muted", label: "확인중 · Unknown", dot: "bg-muted" },
};

const REFRESH_MS = 15_000;

/** Render stage counts as chips using the STAGE_META color and label (shared by cards and group headers). */
function StageChips({ counts, dot = false }: { counts: Record<Stage, number>; dot?: boolean }) {
  return (
    <>
      {STAGE_VIEW.map((st) => counts[st] > 0 && (
        <span key={st} className="inline-flex items-center gap-1 text-[10px] text-muted tabular-nums" title={STAGE_META[st].label}>
          <span className={`w-2 h-2 rounded-full ${STAGE_META[st].dot}`} />
          {dot ? counts[st] : `${STAGE_META[st].label} ${counts[st]}`}
        </span>
      ))}
    </>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function TrackingSidebar({
  reloadKey, active = true, onFollowup,
}: {
  reloadKey: number;
  active?: boolean;
  /** Follow-up (re-send): prefill the send screen with recipients (names) and the original's settings. */
  onFollowup?: (payload: FollowupPayload) => void;
}) {
  const [sends, setSends] = useState<SendSummary[]>([]);
  const [lists, setLists] = useState<Record<string, string>>({}); // slug → name
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filterList, setFilterList] = useState<string | null>(null);
  const [openSendId, setOpenSendId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sendsR, listsR] = await Promise.all([
        fetch(filterList ? `/api/sends?list=${encodeURIComponent(filterList)}` : "/api/sends"),
        fetch("/api/lists"),
      ]);
      if (!sendsR.ok) throw new Error(`HTTP ${sendsR.status}`);
      const sj = await sendsR.json();
      const lj = await listsR.json().catch(() => ({ lists: [] }));
      setSends(sj.sends ?? []);
      const map: Record<string, string> = {};
      for (const l of lj.lists ?? []) map[l.slug] = l.name;
      setLists(map);
      setErr(null);
      setLastUpdated(new Date());
    } catch (e: any) {
      setErr(e?.message ?? "조회 실패");
    } finally {
      setLoading(false);
    }
  }, [filterList]);

  useEffect(() => {
    // Stop polling while the sidebar is closed, to avoid Resend API calls and disk readdir load.
    if (!active) return;
    fetchData();
    const t = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchData, reloadKey, active]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <div className="kicker">Send History</div>
            <h2 className="mt-1 text-sm font-semibold">
              {filterList ? `${lists[filterList] ?? filterList} 발송 이력` : "최근 발송"}
            </h2>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="icon-btn text-muted hover:text-brand disabled:opacity-60"
            title="새로고침"
          >
            <RefreshIcon spinning={loading} />
          </button>
        </div>
        <div className="mt-1 text-[10px] text-muted flex items-center gap-2">
          {lastUpdated && <span>마지막 갱신 {timeAgo(lastUpdated.toISOString())}</span>}
          <span>· 15초마다 자동</span>
          {filterList && (
            <button onClick={() => setFilterList(null)} className="ml-auto text-brand hover:underline">
              ✕ 필터 해제
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="m-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-600">{err}</div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sends.length === 0 && !loading && (
          <div className="text-xs text-muted text-center py-10 border border-dashed border-border rounded-xl">
            {filterList ? "이 리스트로 보낸 발송이 없습니다." : "아직 발송 기록이 없습니다."}
          </div>
        )}

        {sends.map((s) => (
          <SendCard
            key={s.id}
            send={s}
            lists={lists}
            onClickList={(slug) => setFilterList(slug)}
            onClickCard={() => setOpenSendId(s.id)}
          />
        ))}

      </div>

      {openSendId && (
        <SendDetailModal
          sendId={openSendId}
          lists={lists}
          onClose={() => setOpenSendId(null)}
          onFollowup={onFollowup}
        />
      )}
    </div>
  );
}

function SendCard({
  send, lists, onClickList, onClickCard,
}: {
  send: SendSummary;
  lists: Record<string, string>;
  onClickList: (slug: string) => void;
  onClickCard: () => void;
}) {
  const { total, sent, failed } = send.summary;
  // Both the bar and dots on the card come from the stage classification (statusBreakdown): same color, same meaning.
  const raw = send.statusBreakdown ?? { delivered: 0, sent, bounced: 0, failed, pending: total - sent - failed };
  const bd: Record<Stage, number> = { skipped: 0, ...raw } as Record<Stage, number>;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <div className="rounded-xl border border-border hover:border-brand/40 p-3 transition cursor-pointer" onClick={onClickCard}>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          send.status === "running" ? "bg-yellow-500 animate-pulse" :
          send.status === "aborted" ? "bg-orange-500" : "bg-green-500"
        }`} />
        <div className="text-[12px] text-text/90 truncate flex-1">{send.subject}</div>
        {send.scheduledAt && <span className="chip shrink-0 text-brand border-brand/40">예약</span>}
        {send.kind === "followup" && <span className="chip shrink-0">재발송</span>}
        {send.kind === "test" && <span className="chip shrink-0 text-muted">테스트</span>}
        <div className="text-[10px] text-muted shrink-0">{timeAgo(send.scheduledAt ?? send.createdAt)}</div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        {send.listSlugs.map((slug) => (
          <button
            key={slug}
            onClick={(e) => { e.stopPropagation(); onClickList(slug); }}
            className="chip hover:border-brand/40 hover:text-brand"
          >
            {lists[slug] ?? slug}
          </button>
        ))}
        {send.adhocCount > 0 && <span className="chip text-muted">ad-hoc {send.adhocCount}</span>}
        <span className="text-[11px] text-muted ml-auto truncate max-w-[180px]" title={send.templateName}>{send.templateTitle ?? send.templateName}</span>
      </div>

      <div className="mt-2 flex h-1.5 w-full rounded-full overflow-hidden bg-surface2">
        {STAGE_VIEW.map((st) => bd[st] > 0 && <div key={st} className={STAGE_META[st].bar} style={{ width: `${pct(bd[st])}%` }} />)}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px]">
        <span className="text-muted">{total}명</span>
        <span className="flex items-center gap-2.5"><StageChips counts={bd} dot /></span>
      </div>
    </div>
  );
}

function SendDetailModal({
  sendId, lists, onClose, onFollowup,
}: {
  sendId: string;
  lists: Record<string, string>;
  onClose: () => void;
  onFollowup?: (payload: FollowupPayload) => void;
}) {
  const [detail, setDetail] = useState<SendDetail | null>(null);
  const [metrics, setMetrics] = useState<SendMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleGroup(key: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const load = useCallback(async (withStatus: boolean, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await fetch(`/api/sends/${encodeURIComponent(sendId)}${withStatus ? "?withStatus=1" : ""}`);
      const j = await r.json();
      if (j.send) setDetail(j.send);
      if (j.metrics) setMetrics(j.metrics);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [sendId]);

  // Show the base data as soon as it opens, then immediately auto-fetch live Resend status (manual button removed).
  useEffect(() => { load(false).then(() => load(true, true)); }, [load]);

  // Auto-refresh live status every 15s, querying Resend only while some recipients are
  // not yet confirmed delivered (sent/pending); no needless calls once all are settled. Silent, no spinner.
  // The number of auto-fetches is capped (about 10 minutes) so a long-open modal never polls forever.
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const autoPollsRef = useRef(0);
  useEffect(() => {
    const t = setInterval(() => {
      if (autoPollsRef.current >= 40) return;
      const d = detailRef.current;
      const hasLive = d?.recipients.some((r) => { const st = stageOf(r); return st === "sent" || st === "pending"; });
      if (hasLive) { autoPollsRef.current++; load(true, true); }
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Close on ESC
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const failedRecipients = detail ? detail.recipients.filter((r) => r.status === "failed").map((r) => ({ email: r.email, name: r.name })) : [];
  // Reminder targets = recipients without a Delivered confirmation. opened/clicked tracking is unreliable,
  // so we judge by delivery instead of opens. Bounced/complained are auto-excluded at send time anyway, so leave them out.
  const remindRecipients = detail
    ? detail.recipients.filter((r) => r.status === "sent" && !["delivered", "opened", "clicked", "bounced", "complained"].includes((r.liveStatus ?? "").toLowerCase())).map((r) => ({ email: r.email, name: r.name }))
    : [];
  // Continue sending = people who never started: '대기' left over from an abort/server restart, and '미발송' dropped by the send limit.
  // (Unsubscribed, schedule-canceled and manually removed people are intentionally unsent, so excluded.)
  const unsentRecipients = detail
    ? detail.recipients.filter((r) => (r.status === "pending" && detail.status !== "running") || (r.status === "skipped" && isUnreachedSkip(r.error))).map((r) => ({ email: r.email, name: r.name }))
    : [];
  const failedEmails = failedRecipients.map((r) => r.email);
  const allEmails = detail ? detail.recipients.map((r) => r.email) : [];
  // A reminder only makes sense once delivery is mostly done: enable it only when 30 minutes have passed since the send finished
  // and at least one person is confirmed '전달' or beyond (right after sending everyone is '전송중', so it would risk duplicates).
  const REMIND_DELAY_MS = 30 * 60 * 1000;
  const finishedAgo = detail?.finishedAt ? Date.now() - new Date(detail.finishedAt).getTime() : 0;
  const hasLiveStatus = !!detail && finishedAgo >= REMIND_DELAY_MS &&
    detail.recipients.some((r) => ["delivered", "opened", "clicked"].includes((r.liveStatus ?? "").toLowerCase()));

  function buildFollowup(recipients: { email: string; name?: string }[]): FollowupPayload {
    return { recipients, sourceSendId: detail!.id, templateName: detail!.templateName, isAd: detail!.isAd, from: detail!.from, replyTo: detail!.replyTo };
  }

  // Group recipients by list (slug). Ad-hoc ones (no listSlug) form one group. Send order is preserved.
  const groups = useMemo(() => {
    const m = new Map<string, SendDetail["recipients"]>();
    for (const r of detail?.recipients ?? []) {
      const key = r.listSlug || "__adhoc__";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return Array.from(m.entries());
  }, [detail]);

  const groupKeys = groups.map(([k]) => k);
  const allOpen = groupKeys.length > 0 && groupKeys.every((k) => expanded.has(k));
  function toggleAll() { setExpanded(allOpen ? new Set() : new Set(groupKeys)); }

  // On first load: auto-expand when there is one group or few recipients (<=30), so the modal doesn't look empty.
  // After that, the user's collapse/expand state is preserved (auto-refresh doesn't overwrite it).
  const didInitExpand = useRef(false);
  useEffect(() => {
    if (!detail || didInitExpand.current || groupKeys.length === 0) return;
    didInitExpand.current = true;
    if (groupKeys.length === 1 || detail.recipients.length <= 30) setExpanded(new Set(groupKeys));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  const openRate = metrics && metrics.sent > 0 ? Math.round((metrics.opened / metrics.sent) * 100) : null;
  const clickRate = metrics && metrics.sent > 0 ? Math.round((metrics.clicked / metrics.sent) * 100) : null;

  async function copy(list: string[]) {
    if (list.length === 0) return;
    await navigator.clipboard?.writeText(list.join("\n"));
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl h-[86vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <div className="kicker">Send Detail</div>
            <h2 className="text-base font-semibold truncate mt-0.5">{detail?.subject ?? "…"}</h2>
          </div>
          <div className="flex items-center gap-2">
            <a href={`/api/sends/${encodeURIComponent(sendId)}?format=csv`} className="icon-btn" title="결과 CSV 다운로드" aria-label="결과 CSV 다운로드">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12M6 11l6 6 6-6" />
                <path d="M4 21h16" />
              </svg>
            </a>
            <button onClick={onClose} className="icon-btn">✕</button>
          </div>
        </div>

        {loading || !detail ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted">불러오는 중…</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <dl className="text-[12px] space-y-1.5">
              <DRow label="발송일시">{new Date(detail.createdAt).toLocaleString("ko-KR")}</DRow>
              <DRow label="발송자">{detail.sentBy}</DRow>
              <DRow label="이메일">{detail.templateTitle ?? detail.templateName}</DRow>
              {detail.scheduledAt && <DRow label="예약 시각">{formatKst(detail.scheduledAt, { withYear: true })} {ZONE_LABEL}</DRow>}
              <DRow label="From"><span className="font-mono">{detail.from}</span></DRow>
              <DRow label="리스트">
                {detail.listSlugs.length > 0 ? detail.listSlugs.map((s) => lists[s] ?? s).join(", ") : "ad-hoc only"}
              </DRow>
              <DRow label="상태">
                <span className={
                  detail.status === "running" ? "text-yellow-500" :
                  detail.status === "aborted" ? "text-orange-500" : "text-green-600"
                }>
                  {detail.status === "running" ? "진행 중" : detail.status === "aborted" ? "중단됨" : "완료"}
                </span>
              </DRow>
            </dl>

            {/* Performance metrics */}
            {metrics && (
              <div className="grid grid-cols-4 gap-2">
                <Metric label="발송" value={metrics.sent} />
                <Metric label="전달" value={metrics.delivered} tone="green" />
                <Metric label="열람" value={metrics.opened} sub={openRate != null ? `${openRate}%` : undefined} tone="blue" />
                <Metric label="클릭" value={metrics.clicked} sub={clickRate != null ? `${clickRate}%` : undefined} tone="purple" />
              </div>
            )}
            {metrics && (metrics.bounced > 0 || metrics.complained > 0 || metrics.failed > 0) && (
              <div className="flex gap-2 text-[11px]">
                {metrics.failed > 0 && <span className="text-red-500">실패 {metrics.failed}</span>}
                {metrics.bounced > 0 && <span className="text-red-600">반송 {metrics.bounced}</span>}
                {metrics.complained > 0 && <span className="text-orange-600">스팸신고 {metrics.complained}</span>}
              </div>
            )}

            {/* Follow-up actions */}
            <div className="rounded-lg border border-border p-3 bg-surface2/20 space-y-2">
              <div className="text-[11px] text-muted">재발송 · 대상만 발송 화면에 반영</div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => { if (failedRecipients.length && onFollowup) { onFollowup(buildFollowup(failedRecipients)); onClose(); } }}
                  disabled={failedRecipients.length === 0}
                  className="btn-ghost text-xs disabled:opacity-40"
                  title="발송 실패한 수신자만 다시 발송 (이름·광고성·발신자 승계)"
                >↻ 실패자 재발송 {failedRecipients.length > 0 && `(${failedRecipients.length})`}</button>
                <button
                  onClick={() => { if (remindRecipients.length && hasLiveStatus && onFollowup) { onFollowup(buildFollowup(remindRecipients)); onClose(); } }}
                  disabled={remindRecipients.length === 0 || !hasLiveStatus}
                  className="btn-ghost text-xs disabled:opacity-40"
                  title={hasLiveStatus ? "전달 미확인 수신자 재발송" : "발송 완료 30분 후 · 전달 확인 이후 활성"}
                >🔔 리마인더 · 미전달 {hasLiveStatus && remindRecipients.length > 0 ? `(${remindRecipients.length})` : ""}</button>
                {unsentRecipients.length > 0 && (
                  <button
                    onClick={() => { if (onFollowup) { onFollowup(buildFollowup(unsentRecipients)); onClose(); } }}
                    className="btn-ghost text-xs"
                    title="중단·서버 재시작·발송 한도로 미발송된 수신자"
                  >▶ 미발송자 다시 보내기 ({unsentRecipients.length})</button>
                )}
                <button onClick={() => copy(failedEmails)} disabled={failedEmails.length === 0} className="text-[11px] text-muted hover:text-text disabled:opacity-40">📋 실패 복사</button>
                <button onClick={() => copy(allEmails)} className="text-[11px] text-muted hover:text-text">📋 전체 복사</button>
              </div>
              {!hasLiveStatus && (
                <p className="text-[12px] text-muted">리마인더: 발송 완료 30분 후 · 전달 확인 이후 활성</p>
              )}
            </div>

            {/* Recipients: grouped by list (collapse/expand), classified by stage within each group */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-muted">수신자 ({detail.recipients.length}명) · 리스트별</div>
                <div className="flex items-center gap-2">
                  {groups.length > 1 && <button onClick={toggleAll} className="text-[10px] text-brand hover:underline">{allOpen ? "모두 접기" : "모두 펼치기"}</button>}
                  {groups.length > 1 && <span className="text-muted/40">·</span>}
                  <button onClick={() => setGuideOpen((o) => !o)} className="text-[10px] text-muted hover:text-text hover:underline">상태 설명 {guideOpen ? "▾" : "▸"}</button>
                </div>
              </div>
              <StatusGuide open={guideOpen} />
              {groups.map(([key, rs]) => {
                const isAdhoc = key === "__adhoc__";
                const label = isAdhoc ? "직접 입력 (ad-hoc)" : (lists[key] ?? key);
                const sc = stageCounts(rs);
                const open = expanded.has(key);
                return (
                  <div key={key} className="rounded-lg border border-border overflow-hidden">
                    <button onClick={() => toggleGroup(key)} className="w-full flex items-center gap-2 px-3 py-2 bg-surface2/40 hover:bg-surface2/70 text-left transition">
                      <span className="text-muted text-[11px] w-3 shrink-0">{open ? "▾" : "▸"}</span>
                      <span className="text-[12px] font-semibold text-text/90 truncate">{label}</span>
                      <span className="chip shrink-0">{rs.length}명</span>
                      <span className="ml-auto flex items-center gap-2.5 shrink-0"><StageChips counts={sc} /></span>
                    </button>
                    {open && (
                      <table className="w-full text-[12px] border-t border-border">
                        <tbody><GroupRows rs={rs} /></tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Sort recipients within one list group by stage and render them under stage subheadings. */
function GroupRows({ rs }: { rs: SendDetail["recipients"] }) {
  const sorted = [...rs].sort((a, b) => STAGE_ORDER[stageOf(a)] - STAGE_ORDER[stageOf(b)]);
  const counts: Partial<Record<Stage, number>> = {};
  for (const r of sorted) { const st = stageOf(r); counts[st] = (counts[st] ?? 0) + 1; }
  const rows: JSX.Element[] = [];
  let prev: Stage | null = null;
  for (const r of sorted) {
    const st = stageOf(r);
    if (st !== prev) {
      prev = st;
      rows.push(
        <tr key={`h-${st}`} className="bg-surface2/40">
          <td colSpan={2} className="px-3 py-1 text-[10px] text-muted font-semibold">
            <span className={`inline-block w-2 h-2 rounded-full mr-1.5 align-middle ${STAGE_META[st].dot}`} />{STAGE_META[st].label} ({counts[st]})
          </td>
        </tr>
      );
    }
    const s = (r.liveStatus ?? r.status ?? "unknown").toLowerCase();
    const meta = STATUS_META[s] ?? STATUS_META.unknown;
    rows.push(
      <tr key={r.email} className="border-t border-border align-top" title={r.error ?? ""}>
        <td className="px-3 py-1.5 font-mono text-text/90">
          <div className="truncate">{r.email}{r.name && <span className="text-muted font-sans ml-1.5">{r.name}</span>}</div>
          {(r.status === "failed" || r.status === "skipped") && r.error && (
            <div className="text-[10px] text-red-500 font-sans mt-0.5 break-words whitespace-normal">⚠ {r.error}</div>
          )}
        </td>
        <td className="px-3 py-1.5 text-right whitespace-nowrap">
          <span className={`inline-flex items-center gap-1 ${meta.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            {meta.label.split(" · ")[0]}
          </span>
        </td>
      </tr>
    );
  }
  return <>{rows}</>;
}

function Metric({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "green" | "blue" | "purple" }) {
  const color = tone === "green" ? "text-green-600" : tone === "blue" ? "text-blue-600" : tone === "purple" ? "text-purple-600" : "text-text";
  return (
    <div className="stat-box text-center">
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`text-lg font-extrabold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`w-3.5 h-3.5 ${spinning ? "animate-spin" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

/** Fixed to one line: if it overflows, shrink the font down to 9px instead of wrapping, then truncate with an ellipsis. */
function FitText({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.fontSize = "";
    let size = parseFloat(getComputedStyle(el).fontSize) || 12;
    while (size > 9 && el.scrollWidth > el.clientWidth + 1) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  });
  return (
    <span ref={ref} className="block whitespace-nowrap overflow-hidden text-ellipsis">
      {children}
    </span>
  );
}

function DRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 items-baseline">
      <dt className="text-muted shrink-0">{label}</dt>
      <dd className="text-right min-w-0 flex-1"><FitText>{children}</FitText></dd>
    </div>
  );
}
