"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fillPlaceholders, fillSubject, hasBlankNameRisk } from "@/lib/personalize";
import { useEscClose } from "./hooks";

export type ConfirmRecipient = { email: string; name?: string; source: string };

/**
 * 발송 최종 확인 — 3-pane 대형 모달.
 *  좌: 발송 요약 (이메일·발신자·리스트·수신자 수)
 *  중앙: 선택된 수신자에게 실제로 도착할 모습 (개인화 치환 완료 렌더)
 *  우: 전체 수신자 리스트 (검색·클릭으로 미리보기 대상 전환, 첫 수신자 기본 선택)
 *
 * 치환은 토큰 보존 HTML(/api/templates?built=)을 1회 받아 클라이언트에서 수행 —
 * 수신자 전환에 네트워크 왕복이 없다. 수신거부/반송 명단도 함께 조회해 제외 표시.
 */
export default function ConfirmSendModal({
  template,
  subject,
  isAd,
  from,
  replyTo,
  listNames,
  recipients,
  onClose,
  onConfirm,
}: {
  template: string;
  subject: string;
  isAd: boolean;
  from: string;
  replyTo: string;
  listNames: string[];
  recipients: ConfirmRecipient[];
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [suppressed, setSuppressed] = useState<Map<string, string>>(new Map());
  const [selectedEmail, setSelectedEmail] = useState<string>(recipients[0]?.email ?? "");
  const [query, setQuery] = useState("");
  const [namelessOnly, setNamelessOnly] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEscClose(true, onClose);

  // 토큰 보존 HTML + 수신거부 명단 1회 로드
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
        if (!r.ok) return;
        const j = await r.json();
        if (cancel) return;
        const m = new Map<string, string>();
        for (const s of j.suppressions ?? []) m.set(String(s.email ?? "").toLowerCase(), String(s.reason ?? ""));
        setSuppressed(m);
      } catch {}
    })();
    return () => { cancel = true; };
  }, [template]);

  const adSubject = isAd && !/^\(광고\)/.test(subject) ? `(광고) ${subject}` : subject;
  const nameRisk = rawHtml !== null && hasBlankNameRisk(rawHtml + " " + adSubject);
  const namelessCount = useMemo(() => recipients.filter((r) => !r.name?.trim()).length, [recipients]);
  const suppressedCount = useMemo(
    () => recipients.filter((r) => suppressed.has(r.email.toLowerCase())).length,
    [recipients, suppressed],
  );
  const effectiveCount = recipients.length - suppressedCount;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = recipients;
    if (namelessOnly) arr = arr.filter((r) => !r.name?.trim());
    if (q) arr = arr.filter((r) => r.email.includes(q) || (r.name ?? "").toLowerCase().includes(q));
    return arr;
  }, [recipients, query, namelessOnly]);

  const selected = recipients.find((r) => r.email === selectedEmail) ?? shown[0] ?? recipients[0];

  // 선택 수신자 기준 실제 발송본 (수신거부 URL 만 발송 시 서명 URL 로 치환됨)
  const personalizedHtml = useMemo(() => {
    if (rawHtml === null || !selected) return null;
    return fillPlaceholders(rawHtml, { name: selected.name, email: selected.email, unsubscribeUrl: "#" });
  }, [rawHtml, selected]);
  const personalizedSubject = selected ? fillSubject(adSubject, { name: selected.name, email: selected.email }) : adSubject;

  // 키보드 ↑/↓ 로 수신자 전환
  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const idx = shown.findIndex((r) => r.email === selected?.email);
    const next = shown[idx + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) setSelectedEmail(next.email);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="card w-[min(1200px,95vw)] h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <div className="kicker">최종 확인</div>
            <h3 className="text-base font-semibold mt-0.5">발송 직전 확인 — 수신자를 클릭하면 그 사람에게 갈 모습이 보입니다</h3>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="닫기">✕</button>
        </div>

        {/* 본문 3-pane */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)_290px]">
          {/* 좌: 요약 */}
          <div className="border-b lg:border-b-0 lg:border-r border-border p-4 overflow-y-auto space-y-4">
            <dl className="text-[13px] space-y-2.5">
              <Row label="이메일"><span className="font-mono text-[12px]">{template}</span></Row>
              <Row label="제목">{adSubject}</Row>
              <Row label="From"><span className="font-mono text-[12px]">{from}</span></Row>
              <Row label="Reply-To"><span className="font-mono text-[12px]">{replyTo || "발신자 주소로 회신"}</span></Row>
              <Row label="리스트">{listNames.length > 0 ? listNames.join(", ") : <span className="text-muted">없음</span>}</Row>
              <Row label="총 수신자"><span className="text-brand font-bold">{effectiveCount}명</span></Row>
            </dl>

            {suppressedCount > 0 && (
              <div className="text-[11px] text-amber-700 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2.5 py-2">
                수신거부/반송 {suppressedCount}명은 발송 시 자동 제외됩니다.
              </div>
            )}
            {effectiveCount >= 100 && (
              <div className="text-[11px] text-amber-700 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2.5 py-2">
                ⚠ {effectiveCount}명에게 한 번에 발송합니다. 대상·제목·발신자를 다시 확인하세요.
              </div>
            )}
            <p className="text-[10.5px] text-muted leading-relaxed">
              ⚠ 발송 시작 후에는 ‘발송 중단’으로만 멈출 수 있고, 이미 보낸 메일은 회수되지 않습니다.
              미리보기의 수신거부 링크는 발송 시 수신자별 실제 URL로 치환됩니다.
            </p>
          </div>

          {/* 중앙: 개인화 완료 미리보기 */}
          <div className="border-b lg:border-b-0 lg:border-r border-border flex flex-col min-h-0 bg-surface2/40">
            <div className="px-4 py-2 border-b border-border shrink-0 bg-surface">
              <div className="text-[10px] text-muted">받는 사람: <span className="font-mono">{selected ? `${selected.name ? `${selected.name} ` : ""}<${selected.email}>` : "—"}</span></div>
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
                <div className="text-[11px] text-amber-700 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2.5 py-1.5">
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
                const isSupp = suppressed.has(r.email.toLowerCase());
                return (
                  <button
                    key={r.email}
                    onClick={() => setSelectedEmail(r.email)}
                    className={`w-full text-left px-3 py-2 border-b border-border/60 transition ${
                      active ? "bg-brand/10 border-l-2 border-l-brand" : "hover:bg-surface2/60 border-l-2 border-l-transparent"
                    } ${isSupp ? "opacity-50" : ""}`}
                    style={{ contentVisibility: "auto", containIntrinsicSize: "auto 52px" } as React.CSSProperties}
                  >
                    <div className="flex items-center gap-1.5">
                      {r.name?.trim() ? (
                        <span className="text-[12px] text-text/90 truncate">{r.name}</span>
                      ) : (
                        <span className="text-[11px] text-amber-500/90">이름 없음</span>
                      )}
                      {isSupp && <span className="chip text-red-500 shrink-0" title={`수신거부/반송 — 발송 시 자동 제외 (${suppressed.get(r.email.toLowerCase())})`}>제외됨</span>}
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
          <button onClick={onConfirm} className="btn-primary">{effectiveCount}명에게 발송</button>
        </div>
      </div>
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
