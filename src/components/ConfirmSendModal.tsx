"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fillPlaceholders, fillSubject, hasBlankNameRisk } from "@/lib/personalize";
import { ensureUnsubFooter } from "@/lib/unsub-footer";
import { kstInputToDate, toKstParts, formatKst } from "@/lib/kst";
import { useEscClose } from "./hooks";
import { PRIOR_LABEL } from "@/lib/status-text";
import KstDateTimeInput, { type KstValue } from "./KstDateTimeInput";

export type ConfirmRecipient = { email: string; name?: string; company?: string; title?: string; source: string };

/** What the sender decided in the confirm step. */
export type ConfirmResult = {
  /** Addresses to leave out (e.g. "already received" → exclude). */
  excludeEmails?: string[];
  /** Set when scheduling instead of sending now (UTC ISO). */
  scheduledAt?: string;
};

type PriorKind = "same" | "modified" | "scheduled";
type PriorHit = { email: string; kind: PriorKind; sendId: string; at: string };


/** Default schedule time: one hour from now, rounded up to 10 minutes (KST). */
function defaultScheduleValue(): KstValue {
  const t = Date.now() + 60 * 60 * 1000;
  const rounded = new Date(Math.ceil(t / (10 * 60 * 1000)) * 10 * 60 * 1000);
  return toKstParts(rounded);
}

/**
 * 발송 최종 확인 — 3-pane 대형 모달.
 *  좌: 발송 요약 (이메일·발신자·리스트·제외·수신자 수) + 지금 보내기 / 예약
 *  중앙: 선택된 수신자에게 실제로 도착할 모습 (개인화 치환 + 광고성 수신거부 문구까지 실제 발송과 동일)
 *  우: 전체 수신자 리스트 (검색·클릭으로 미리보기 대상 전환, 이미 받은 사람 표시)
 * 발송(예약) 버튼을 누를 때 이미 받은 사람이 있으면 취소 / 제외하고 전송 / 일괄 전송을 고르게 한다.
 */
export default function ConfirmSendModal({
  template,
  templateTitle,
  subject,
  isAd,
  from,
  replyTo,
  listNames,
  excludedListNames = [],
  excludedByListCount = 0,
  recipients,
  onClose,
  onConfirm,
}: {
  template: string;
  templateTitle: string;
  subject: string;
  isAd: boolean;
  from: string;
  replyTo: string;
  listNames: string[];
  excludedListNames?: string[];
  excludedByListCount?: number;
  recipients: ConfirmRecipient[];
  onClose: () => void;
  onConfirm: (res: ConfirmResult) => void;
}) {
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [suppressed, setSuppressed] = useState<Map<string, string>>(new Map());
  const [prior, setPrior] = useState<Map<string, PriorHit> | null>(null);
  /** The "already received" check itself failed — never treat that as "nobody received it". */
  const [priorFailed, setPriorFailed] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<string>(recipients[0]?.email ?? "");
  const [query, setQuery] = useState("");
  const [namelessOnly, setNamelessOnly] = useState(false);
  const [priorOnly, setPriorOnly] = useState(false);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [when, setWhen] = useState<KstValue>(defaultScheduleValue);
  const [askPrior, setAskPrior] = useState(false);
  const [timeErr, setTimeErr] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEscClose(!askPrior, onClose);

  // 토큰 보존 HTML + 수신거부 명단 + 이미 받은 사람 1회 로드
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`/api/templates?built=${encodeURIComponent(template)}`);
        if (!r.ok) throw new Error("이메일 본문을 불러오지 못했습니다");
        const j = await r.json();
        if (!cancel) setRawHtml(j.html ?? "");
      } catch (e: any) {
        if (!cancel) setLoadErr(e?.message ?? "본문 로드 실패");
      }
      try {
        const r = await fetch("/api/suppression");
        if (r.ok) {
          const j = await r.json();
          const m = new Map<string, string>();
          for (const s of j.suppressions ?? []) m.set(String(s.email ?? "").toLowerCase(), String(s.reason ?? ""));
          if (!cancel) setSuppressed(m);
        }
      } catch {}
      await loadPrior(() => cancel);
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, recipients]);

  /** Previous recipients of this email (from send history). A failure is shown, never treated as "none". */
  async function loadPrior(cancelled: () => boolean = () => false) {
    setPriorFailed(false);
    try {
      const r = await fetch("/api/sends/prior", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, emails: recipients.map((x) => x.email) }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (!cancelled()) setPrior(new Map((j.hits ?? []).map((h: PriorHit) => [h.email, h])));
    } catch {
      if (!cancelled()) { setPrior(new Map()); setPriorFailed(true); }
    }
  }

  const adSubject = isAd && !/^\(광고\)/.test(subject) ? `(광고) ${subject}` : subject;
  // 실제 발송과 같은 규칙: 광고성이면 수신거부 링크가 없을 때 기본 문구를 붙인다.
  const sendHtml = rawHtml === null ? null : isAd ? ensureUnsubFooter(rawHtml) : rawHtml;
  const footerAdded = !!rawHtml && !!sendHtml && sendHtml !== rawHtml;
  const nameRisk = rawHtml !== null && hasBlankNameRisk(rawHtml + " " + adSubject);
  const namelessCount = useMemo(() => recipients.filter((r) => !r.name?.trim()).length, [recipients]);
  const isSupp = (e: string) => suppressed.has(e.toLowerCase());
  const suppressedCount = useMemo(() => recipients.filter((r) => isSupp(r.email)).length, [recipients, suppressed]); // eslint-disable-line react-hooks/exhaustive-deps
  const effectiveCount = recipients.length - suppressedCount;

  // 이미 받은 사람 — 어차피 빠지는 수신거부자는 셈에서 뺀다.
  const priorHits = useMemo(
    () => (prior ? Array.from(prior.values()).filter((h) => !isSupp(h.email)) : []),
    [prior, suppressed], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const priorCounts = useMemo(() => {
    const c: Record<PriorKind, number> = { same: 0, modified: 0, scheduled: 0 };
    for (const h of priorHits) c[h.kind]++;
    return c;
  }, [priorHits]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = recipients;
    if (namelessOnly) arr = arr.filter((r) => !r.name?.trim());
    if (priorOnly && prior) arr = arr.filter((r) => prior.has(r.email.toLowerCase()));
    if (q) arr = arr.filter((r) => r.email.includes(q) || (r.name ?? "").toLowerCase().includes(q));
    return arr;
  }, [recipients, query, namelessOnly, priorOnly, prior]);

  const selected = recipients.find((r) => r.email === selectedEmail) ?? shown[0] ?? recipients[0];

  const personalizedHtml = useMemo(() => {
    if (sendHtml === null || !selected) return null;
    return fillPlaceholders(sendHtml, { name: selected.name, email: selected.email, company: selected.company, title: selected.title, unsubscribeUrl: "#" });
  }, [sendHtml, selected]);
  const personalizedSubject = selected
    ? fillSubject(adSubject, { name: selected.name, email: selected.email, company: selected.company, title: selected.title })
    : adSubject;

  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const idx = shown.findIndex((r) => r.email === selected?.email);
    const next = shown[idx + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) setSelectedEmail(next.email);
  }

  const scheduleAt = mode === "schedule" ? kstInputToDate(when.date, when.time) : null;
  const ready = rawHtml !== null && prior !== null;

  /** Final step after the "already received" choice. */
  function finish(excludeEmails: string[] = []) {
    setAskPrior(false);
    onConfirm({ excludeEmails, ...(scheduleAt ? { scheduledAt: scheduleAt.toISOString() } : {}) });
  }

  function onPrimary() {
    setTimeErr("");
    if (mode === "schedule") {
      if (!scheduleAt) { setTimeErr("날짜와 시간을 확인하세요"); return; }
      if (scheduleAt.getTime() < Date.now() + 60_000) { setTimeErr("예약 시각은 지금부터 1분 이후여야 합니다"); return; }
    }
    if (priorHits.length > 0) { setAskPrior(true); return; }
    finish();
  }

  const verb = mode === "schedule" ? "예약" : "전송";
  const remaining = effectiveCount - priorHits.length;
  // Kind breakdown only when there is more than one kind (otherwise it would repeat the total).
  const priorKinds = (Object.keys(priorCounts) as PriorKind[]).filter((k) => priorCounts[k] > 0);
  const priorBreakdown = priorKinds.length > 1 ? priorKinds.map((k) => `${PRIOR_LABEL[k]} ${priorCounts[k]}`).join(" · ") : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-[min(1240px,96vw)] h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-semibold">최종 확인</h3>
            <div className="text-[12px] text-muted">수신자 클릭 시 해당 수신자 기준 미리보기</div>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="닫기">✕</button>
        </div>

        {/* 본문 3-pane */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)_290px]">
          {/* 좌: 요약 */}
          <div className="border-b lg:border-b-0 lg:border-r border-border p-4 overflow-y-auto space-y-4">
            <dl className="text-[13px] space-y-2.5">
              <Row label="이메일">{templateTitle}</Row>
              <Row label="제목">{adSubject}</Row>
              <Row label="From"><span className="font-mono text-[12px]">{from}</span></Row>
              <Row label="Reply-To"><span className="font-mono text-[12px]">{replyTo || "발신자 주소로 회신"}</span></Row>
              <Row label="리스트">{listNames.length > 0 ? listNames.join(", ") : <span className="text-muted">없음</span>}</Row>
              {excludedListNames.length > 0 && (
                <Row label="제외 리스트"><span className="text-red-600">{excludedListNames.join(", ")}</span>{excludedByListCount > 0 && <span className="text-muted"> ({excludedByListCount}명 뺌)</span>}</Row>
              )}
              <Row label="총 수신자"><span className="text-brand font-bold">{effectiveCount}명</span></Row>
              {priorHits.length > 0 && (
                <Row label="재발송 대상">
                  <span className="text-amber-700 font-semibold">{priorHits.length}명</span>{" "}
                  <button className="text-[12px] text-brand underline" onClick={() => setPriorOnly((v) => !v)}>{priorOnly ? "전체" : "보기"}</button>
                  {priorBreakdown && <div className="text-[12px] text-muted">{priorBreakdown}</div>}
                </Row>
              )}
              {priorFailed && (
                <Row label="재발송 대상">
                  <span className="text-red-600">확인 실패</span>{" "}
                  <button className="text-[12px] text-brand underline" onClick={() => loadPrior()}>다시 확인</button>
                </Row>
              )}
              {suppressedCount > 0 && <Row label="자동 제외">수신거부·반송 {suppressedCount}명</Row>}
              {footerAdded && <Row label="수신거부 문구">하단 자동 추가</Row>}
            </dl>

            {/* 지금 / 예약 */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                <button className={mode === "now" ? "btn text-xs justify-center py-2 border border-brand bg-brand/10 text-brand" : "btn-ghost text-xs justify-center py-2"} onClick={() => setMode("now")}>지금 보내기</button>
                <button className={mode === "schedule" ? "btn text-xs justify-center py-2 border border-brand bg-brand/10 text-brand" : "btn-ghost text-xs justify-center py-2"} onClick={() => setMode("schedule")}>예약하기</button>
              </div>
              {mode === "schedule" && (
                <div className="rounded-lg border border-border bg-surface2/40 p-2.5 space-y-1.5">
                  <KstDateTimeInput value={when} onChange={setWhen} />
                  {timeErr && <div className="text-[12px] text-red-500">{timeErr}</div>}
                  <p className="text-[12px] text-red-600">서버 중단 시각의 예약은 미실행</p>
                </div>
              )}
            </div>

            <p className="text-[12px] text-muted">발송 후 회수 불가 · 진행 중 중단만 가능</p>
          </div>

          {/* 중앙: 개인화 완료 미리보기 */}
          <div className="border-b lg:border-b-0 lg:border-r border-border flex flex-col min-h-0 bg-surface2/40">
            <div className="px-4 py-2 border-b border-border shrink-0 bg-surface">
              <div className="text-[11px] text-muted">받는 사람: <span className="font-mono">{selected ? `${selected.name ? `${selected.name} ` : ""}<${selected.email}>` : "—"}</span></div>
              <div className="text-[13px] font-semibold truncate mt-0.5" title={personalizedSubject}>{personalizedSubject}</div>
            </div>
            <div className="flex-1 min-h-0 p-3 overflow-hidden">
              {loadErr ? (
                <div className="h-full flex items-center justify-center text-xs text-red-500">{loadErr}</div>
              ) : personalizedHtml === null ? (
                <div className="h-full flex items-center justify-center text-xs text-muted">불러오는 중…</div>
              ) : (
                <iframe
                  title="confirm-preview"
                  srcDoc={personalizedHtml}
                  sandbox="allow-same-origin"
                  className="w-full h-full bg-white rounded-lg border border-border"
                />
              )}
            </div>
          </div>

          {/* 우: 수신자 리스트 */}
          <div className="flex flex-col min-h-0">
            <div className="p-3 border-b border-border shrink-0 space-y-2">
              <input
                className="input py-1.5 text-[12px]"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`🔍 ${recipients.length}명 검색 (이름·이메일)`}
              />
              {nameRisk && namelessCount > 0 && (
                <div className="text-[12px] text-amber-700 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2.5 py-1.5">
                  이름 없는 수신자 {namelessCount}명 — <span className="font-mono">{"{{name}}"}</span> 자리가 빈칸으로 발송됩니다.{" "}
                  <button className="underline" onClick={() => setNamelessOnly((v) => !v)}>
                    {namelessOnly ? "전체 보기" : "해당 인원만 보기"}
                  </button>
                </div>
              )}
            </div>
            <div ref={listRef} tabIndex={0} onKeyDown={onListKeyDown} className="flex-1 overflow-y-auto outline-none">
              {shown.map((r) => {
                const active = r.email === selected?.email;
                const supp = isSupp(r.email);
                const hit = prior?.get(r.email.toLowerCase());
                return (
                  <button
                    key={r.email}
                    onClick={() => setSelectedEmail(r.email)}
                    className={`w-full text-left px-3 py-2 border-b border-border/60 transition ${
                      active ? "bg-brand/10 border-l-2 border-l-brand" : "hover:bg-surface2/60 border-l-2 border-l-transparent"
                    } ${supp ? "opacity-50" : ""}`}
                    style={{ contentVisibility: "auto", containIntrinsicSize: "auto 52px" } as React.CSSProperties}
                  >
                    <div className="flex items-center gap-1.5">
                      {r.name?.trim() ? (
                        <span className="text-[12px] text-text/90 truncate">{r.name}</span>
                      ) : (
                        <span className="text-[11px] text-amber-500/90">이름 없음</span>
                      )}
                      {supp && <span className="chip text-red-500 shrink-0" title={`수신거부/반송 — 발송 시 자동 제외 (${suppressed.get(r.email.toLowerCase())})`}>제외됨</span>}
                      {!supp && hit && (
                        <span className="chip text-amber-700 border-amber-400/50 shrink-0" title={`${formatKst(hit.at)} KST`}>{PRIOR_LABEL[hit.kind]}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="font-mono text-[11px] text-muted truncate">{r.email}</span>
                      <span className="text-[10px] text-muted/70 shrink-0">{r.source}</span>
                    </div>
                  </button>
                );
              })}
              {shown.length === 0 && (
                <div className="py-8 text-center text-xs text-muted">검색 결과가 없습니다</div>
              )}
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose} className="btn-ghost">취소</button>
          <button onClick={onPrimary} disabled={!ready} className="btn-primary">
            {!ready ? "확인 중…" : mode === "schedule"
              ? `${scheduleAt ? `${formatKst(scheduleAt)} KST에 ` : ""}${effectiveCount}명 예약`
              : `${effectiveCount}명에게 발송`}
          </button>
        </div>
      </div>

      {/* 이미 받은 사람 — 취소 / 제외하고 전송 / 일괄 전송 */}
      {askPrior && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setAskPrior(false); }}>
          <div className="card w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">재발송 대상 {priorHits.length}명</h3>
            {priorBreakdown && <div className="text-[13px] text-muted">{priorBreakdown}</div>}
            <div className="rounded-lg border border-border max-h-48 overflow-y-auto">
              {priorHits.map((h) => (
                <div key={h.email} className="flex items-center justify-between gap-2 px-2.5 py-1 text-[12px] border-b border-border/60 last:border-b-0">
                  <span className="font-mono truncate">{h.email}</span>
                  <span className="text-muted shrink-0">{PRIOR_LABEL[h.kind]} · {formatKst(h.at)}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button className="btn-ghost text-sm" onClick={() => setAskPrior(false)}>취소</button>
              <button className="btn-ghost text-sm" onClick={() => finish()}>{effectiveCount}명에게 {verb}</button>
              {remaining > 0 && (
                <button className="btn-primary text-sm" onClick={() => finish(priorHits.map((h) => h.email))}>{remaining}명에게 {verb}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted shrink-0">{label}</dt>
      <dd className="text-right break-all">{children}</dd>
    </div>
  );
}
