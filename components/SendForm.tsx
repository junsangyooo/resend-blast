"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AddTemplateDialog from "./AddTemplateDialog";
import TemplateComposer from "./TemplateComposer";
import ListPicker from "./ListPicker";
import ListEditor from "./ListEditor";
import RecipientInput from "./RecipientInput";
import ConfirmSendModal from "./ConfirmSendModal";
import type { ComposerState } from "@/app/page";
import type { Recipient } from "@/lib/recipients";
import { brand } from "@/brand.config";

type Template = { name: string; subject: string; description: string; size: number; composed: boolean; archived: boolean };

type FromOption = { value: string; label: string; builtin?: boolean; scope?: "shared" | "personal"; owner?: string };

type SendEvent =
  | { type: "info"; sendId: string; kind?: string; template: string; subject: string; from: string; valid: number; excludedSuppressed?: number; adhoc: { invalid: string[]; duplicates: string[] } }
  | { type: "ok"; to: string; id?: string; i: number; total: number }
  | { type: "fail"; to: string; error: string; i: number; total: number }
  | { type: "done"; sendId: string; ok: number; fail: number; aborted?: boolean; total: number; failedEmails: string[]; at: string };

export type SendPrefill = {
  template?: string;
  adhoc?: string;
  /** 재발송 시 원본의 광고성 여부·발신자·회신주소를 승계 (컴플라이언스/일관성). */
  isAd?: boolean;
  from?: string;
  replyTo?: string;
  /** 90초 멱등성 중복차단을 우회 (의도된 재발송). */
  force?: boolean;
  nonce: number;
} | null;

type Props = {
  composer: ComposerState;
  setComposer: (s: ComposerState) => void;
  showAddHtml: boolean;
  setShowAddHtml: (v: boolean) => void;
  reloadKey: number;
  listsReloadKey: number;
  onTemplatesChanged: () => void;
  openListManager: () => void;
  onListsChanged: () => void;
  prefill?: SendPrefill;
  configReloadKey?: number;
};

export default function SendForm({
  composer, setComposer, showAddHtml, setShowAddHtml,
  reloadKey, listsReloadKey, onTemplatesChanged, openListManager, onListsChanged, prefill, configReloadKey = 0,
}: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<string>("");

  const [selectedListSlugs, setSelectedListSlugs] = useState<string[]>([]);
  const [listMembersPreview, setListMembersPreview] = useState<{ email: string; name?: string; listSlug: string }[]>([]);
  const [adhoc, setAdhoc] = useState("");
  const [adhocRows, setAdhocRows] = useState<Recipient[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const [fromOptions, setFromOptions] = useState<FromOption[]>([]);
  const [from, setFrom] = useState<string>("");
  const [fromDefault, setFromDefault] = useState<string>("");
  const [myNickEditing, setMyNickEditing] = useState(false);
  const [myNick, setMyNick] = useState("");
  const [replyTo, setReplyTo] = useState<string>("");
  const [isAd, setIsAd] = useState(false);
  const [forceNextSend, setForceNextSend] = useState(false); // 재발송 prefill 시 멱등성 우회 1회
  const [me, setMe] = useState<string>("");
  const [maxRecipients, setMaxRecipients] = useState<number>(1000);

  const [sending, setSending] = useState(false);
  const [events, setEvents] = useState<SendEvent[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [currentSendId, setCurrentSendId] = useState<string | null>(null);
  const [aborting, setAborting] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [archivingNames, setArchivingNames] = useState<Set<string>>(new Set());
  const [htmlEditName, setHtmlEditName] = useState<string | null>(null);
  const [tmplQuery, setTmplQuery] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadTemplates(); }, [reloadKey]);
  useEffect(() => { loadConfig(); }, [configReloadKey]);

  // 팔로업/재발송 등에서 넘어온 prefill 적용
  useEffect(() => {
    if (!prefill) return;
    if (prefill.template) setSelected(prefill.template);
    if (prefill.adhoc !== undefined) setAdhoc(prefill.adhoc);
    if (prefill.isAd !== undefined) setIsAd(prefill.isAd);
    if (prefill.from) setFrom(prefill.from);
    if (prefill.replyTo !== undefined) setReplyTo(prefill.replyTo);
    if (prefill.force) setForceNextSend(true);
    setNotice(
      `재발송 대상이 ‘직접 입력’ 칸에 채워졌습니다 (이름 포함).` +
      `${prefill.isAd ? " 광고성·" : " "}발신자·회신 설정이 원본에서 승계되었습니다. 확인 후 발송하세요.`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  // 발송 중 페이지 이탈 경고
  useEffect(() => {
    if (!sending) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sending]);

  async function loadTemplates() {
    const r = await fetch("/api/templates");
    if (r.status === 401) { location.href = "/login"; return; }
    const j = await r.json();
    const list: Template[] = j.templates || [];
    setTemplates(list);
    const firstVisible = list.find((t) => !t.archived)?.name ?? "";
    setSelected((cur) => (cur && list.some((t) => t.name === cur && !t.archived) ? cur : firstVisible));
  }

  async function loadConfig() {
    const r = await fetch("/api/config");
    if (r.status === 401) { location.href = "/login"; return; }
    const j = await r.json();
    const opts: FromOption[] = j.fromOptions ?? [];
    setFromOptions(opts);
    setFromDefault(j.fromDefault ?? "");
    // 현재 선택값이 여전히 유효하면 유지(관리자가 발신자를 추가/삭제해도 선택 보존), 아니면 기본값.
    setFrom((cur) => (cur && opts.some((o) => o.value === cur) ? cur : (j.fromDefault ?? "")));
    setMe(j.me ?? "");
    setMaxRecipients(j.maxRecipients ?? 1000);
    return opts;
  }

  // 안전망: prefill(재발송 승계) 등으로 들어온 from 이 더 이상 사용 불가하면 교정.
  // (서버가 미등록 발신자를 400 으로 거부하므로, 조용히 잘못 나가는 대신 여기서 미리 교정.)
  // 본인 주소(표시 이름만 다른 경우)는 launch@ 가 아니라 내 personal 옵션으로 재매핑.
  useEffect(() => {
    if (!from || fromOptions.length === 0) return;
    if (fromOptions.some((o) => o.value === from)) return;
    const addrMatch = from.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/)?.[1]?.toLowerCase() ?? (from.includes("@") ? from.toLowerCase() : null);
    const myOption = addrMatch && me && addrMatch === me.toLowerCase()
      ? fromOptions.find((o) => o.scope === "personal")
      : undefined;
    const next = myOption?.value || fromDefault || fromOptions[0]?.value || "";
    setFrom(next);
    // 재발송 안내 등 기존 notice 를 덮어쓰지 않고 덧붙인다.
    const msg = myOption
      ? "원본 발신 이름을 사용할 수 없어 내 계정 발신자로 대체했습니다."
      : "선택했던 발신자를 사용할 수 없어 기본 발신자로 대체했습니다. 발송 전 발신자를 확인하세요.";
    setNotice((prev) => (prev ? `${prev} ⚠ ${msg}` : `⚠ ${msg}`));
  }, [from, fromOptions, fromDefault, me]);

  // 본인 계정 발신 이름(닉네임) 저장 — personal 발신자로 등록되어 다음부터 유지.
  async function saveMyFromName() {
    const nick = myNick.trim();
    if (!nick || !me) return;
    if (/[<>"\\,;:\r\n]/.test(nick) || nick.length > 60) {
      setNotice('발신 이름에는 < > " , ; : 를 쓸 수 없고 60자 이내여야 합니다.');
      return;
    }
    const value = `${nick} <${me.toLowerCase()}>`;
    try {
      const r = await fetch("/api/from", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, label: nick, scope: "personal" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "저장 실패");
      await loadConfig();
      setFrom(value);
      setMyNickEditing(false);
    } catch (e: any) {
      setNotice(e?.message ?? "발신 이름 저장 실패");
    }
  }

  function archiveImmediate(name: string) {
    if (archivingNames.has(name)) return;
    setArchivingNames((prev) => new Set(prev).add(name));
    setTimeout(async () => {
      try {
        await fetch("/api/templates", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, archived: true }),
        });
      } finally {
        onTemplatesChanged();
        setArchivingNames((prev) => { const next = new Set(prev); next.delete(name); return next; });
      }
    }, 250);
  }

  function editTemplate(t: Template) {
    if (t.composed) setComposer({ open: true, editName: t.name });
    else setHtmlEditName(t.name);
  }

  useEffect(() => {
    if (selectedListSlugs.length === 0) { setListMembersPreview([]); return; }
    let cancel = false;
    (async () => {
      const qs = `with=members&slugs=${selectedListSlugs.map(encodeURIComponent).join(",")}`;
      const r = await fetch(`/api/lists?${qs}`);
      if (!r.ok) return;
      const j = await r.json();
      const collected: { email: string; name?: string; listSlug: string }[] = [];
      for (const l of j.lists ?? []) {
        for (const m of l.members ?? []) collected.push({ email: m.email, name: m.name, listSlug: l.slug });
      }
      if (!cancel) setListMembersPreview(collected);
    })();
    return () => { cancel = true; };
  }, [selectedListSlugs, listsReloadKey]);

  const tmplObj = templates.find((t) => t.name === selected);

  const mergedRecipients = useMemo(() => {
    const seen = new Set<string>();
    const out: { email: string; name?: string; source: string }[] = [];
    for (const m of listMembersPreview) {
      const e = m.email.toLowerCase();
      if (seen.has(e)) continue;
      seen.add(e);
      out.push({ email: e, name: m.name, source: m.listSlug });
    }
    for (const r of adhocRows) {
      const e = r.email.toLowerCase();
      if (seen.has(e)) continue;
      seen.add(e);
      out.push({ email: e, name: r.name, source: "ad-hoc" });
    }
    return out;
  }, [listMembersPreview, adhocRows]);

  const validCount = mergedRecipients.length;
  const overCap = validCount > maxRecipients;

  let disabledReason = "";
  if (!selected) disabledReason = "이메일을 선택하세요";
  else if (validCount === 0) disabledReason = "리스트를 선택하거나 수신자를 입력하세요";
  else if (overCap) disabledReason = `1회 최대 ${maxRecipients}명 (현재 ${validCount}명)`;
  else if (!from) disabledReason = "발신자를 선택하세요";
  const canSend = !disabledReason && !sending;
  const canTest = !!selected && !!me && !sending;

  async function runSend(opts?: { testToSelf?: boolean }) {
    const testToSelf = !!opts?.testToSelf;
    setSending(true);
    setEvents([]);
    setConfirmOpen(false);
    setCurrentSendId(null);
    setNotice("");
    try {
      const r = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: selected,
          listSlugs: testToSelf ? [] : selectedListSlugs,
          adhoc: testToSelf ? "" : adhoc,
          from, replyTo, isAd,
          force: testToSelf ? false : forceNextSend,
          testToSelf,
        }),
      });
      if (r.status === 401) { location.href = "/login"; return; }
      if (!r.ok && r.headers.get("content-type")?.includes("json")) {
        const j = await r.json();
        if (j.duplicate) { setNotice(j.error ?? "중복 발송이 차단되었습니다."); return; }
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      if (!r.body) throw new Error("스트림 없음");
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const ln of lines) {
          if (!ln.trim()) continue;
          try {
            const obj = JSON.parse(ln) as SendEvent;
            if (obj.type === "info") setCurrentSendId(obj.sendId);
            setEvents((prev) => [...prev, obj]);
            setTimeout(() => resultRef.current?.scrollTo({ top: 9e9 }), 0);
          } catch {}
        }
      }
    } catch (e: any) {
      setEvents((prev) => [...prev, { type: "fail", to: "(전체)", error: e?.message ?? "발송 실패", i: 0, total: 0 }]);
    } finally {
      setSending(false);
      setAborting(false);
      if (!testToSelf) setForceNextSend(false); // 멱등성 우회는 재발송 직후 1회만
    }
  }

  async function abortSend() {
    if (!currentSendId) return;
    setAborting(true);
    try {
      await fetch(`/api/sends/${encodeURIComponent(currentSendId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ abort: true }),
      });
    } catch {}
  }

  const infoEv = events.find((e) => e.type === "info") as Extract<SendEvent, { type: "info" }> | undefined;
  const total = infoEv?.valid ?? 0;
  const processed = events.filter((e) => e.type === "ok" || e.type === "fail").length;
  const okCount = events.filter((e) => e.type === "ok").length;
  const failCount = events.filter((e) => e.type === "fail").length;
  const doneEv = events.find((e) => e.type === "done") as Extract<SendEvent, { type: "done" }> | undefined;
  const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const previewUrl = selected ? `/api/templates?preview=${selected}` : "";
  const visible = templates.filter((t) => !t.archived);
  const shownTemplates = tmplQuery.trim()
    ? visible.filter((t) => `${t.name} ${t.subject} ${t.description}`.toLowerCase().includes(tmplQuery.toLowerCase()))
    : visible;

  const selectedListNames = listMembersPreview.length > 0
    ? Array.from(new Set(listMembersPreview.map((m) => m.listSlug)))
    : [];

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)]">
      {/* ─────────── LEFT: controls ─────────── */}
      <div className="overflow-y-auto lg:border-r border-border p-6 space-y-8 bg-surface">
        {/* ① Template */}
        <section className="space-y-3">
          <StepHead n={1} title="이메일 선택" />
          {visible.length > 6 && (
            <input
              className="input py-1.5 text-[12px]"
              value={tmplQuery}
              onChange={(e) => setTmplQuery(e.target.value)}
              placeholder="🔍 이메일 검색 (이름·제목·설명)"
            />
          )}
          <div className="max-h-[32vh] overflow-y-auto pr-0.5 no-scrollbar">
            {shownTemplates.map((t) => {
              const active = t.name === selected;
              const isArchiving = archivingNames.has(t.name);
              return (
                <div
                  key={t.name}
                  className={`relative group overflow-hidden transition-all ${
                    isArchiving ? "opacity-0 translate-x-8 max-h-0 mb-0 pointer-events-none" : "opacity-100 translate-x-0 max-h-[240px] mb-2.5"
                  }`}
                  style={{ transitionDuration: "250ms" }}
                >
                  <button
                    onClick={() => setSelected(t.name)}
                    className={`w-full text-left rounded-xl border p-3.5 pr-[68px] transition ${
                      active ? "border-brand bg-brand/5 ring-1 ring-brand/30" : "border-border hover:border-brand/40 bg-surface"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[12px] text-text/90 truncate">{t.name}</span>
                      {t.composed && <span className="chip shrink-0">블록</span>}
                    </div>
                    <div className="text-[12px] text-text/70 mt-1.5 truncate">{t.subject}</div>
                    {t.description && <div className="text-[11px] text-muted mt-0.5 truncate">{t.description}</div>}
                  </button>
                  <div className="absolute top-2 right-2 flex items-center gap-0.5">
                    <button onClick={(e) => { e.stopPropagation(); editTemplate(t); }} title={t.composed ? "블록 편집기에서 수정" : "HTML 본문 수정"} className="icon-btn text-muted/60 hover:text-brand focus:text-brand"><EditIcon /></button>
                    <button onClick={(e) => { e.stopPropagation(); archiveImmediate(t.name); }} title="보관함으로 이동 (복원 가능)" className="icon-btn text-muted/60 hover:text-red-500 focus:text-red-500"><ArchiveIcon /></button>
                  </div>
                </div>
              );
            })}
            {visible.length === 0 && (
              <div className="text-[12px] text-muted py-6 px-4 text-center border border-dashed border-border rounded-xl space-y-2">
                <div className="text-text/80 font-semibold">처음이신가요?</div>
                <div className="leading-relaxed">
                  ① 왼쪽 <span className="text-brand">이메일</span>에서 “블록으로 만들기”로 메일을 만들고<br />
                  ② <span className="text-brand">리스트</span>에서 수신자를 추가한 뒤<br />
                  ③ 여기서 발송하세요.
                </div>
                <div className="text-[11px]">먼저 <span className="text-brand">✉ 나에게 테스트</span>로 본인에게 보내 확인하는 걸 권장합니다.</div>
              </div>
            )}
            {visible.length > 0 && shownTemplates.length === 0 && (
              <div className="text-xs text-muted py-6 text-center">‘{tmplQuery}’ 검색 결과가 없습니다.</div>
            )}
          </div>
        </section>

        {/* ② Recipients */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <StepHead n={2} title="수신자" />
            {validCount > 0 && (
              <span className="text-[11px] text-muted tabular-nums">
                총 <b className={overCap ? "text-red-500" : "text-brand"}>{validCount}</b>명 · 중복 제외{overCap ? ` · 최대 ${maxRecipients}` : ""}
              </span>
            )}
          </div>
          <ListPicker
            selected={selectedListSlugs}
            onChange={setSelectedListSlugs}
            reloadKey={listsReloadKey}
            onManage={openListManager}
            onQuickAdd={() => setQuickAddOpen(true)}
          />

          <RecipientInput label="직접 입력 (이름 + 이메일)" value={adhoc} onTextChange={setAdhoc} onChange={setAdhocRows} />
        </section>

        {/* ③ 발신 옵션 */}
        <section className="space-y-3">
          <StepHead n={3} title="발신 옵션" />
          <div>
            <label className="block text-[11px] text-muted mb-1">발신자 (From)</label>
            <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
              <optgroup label="공용">
                {fromOptions.filter((o) => o.scope !== "personal").map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
              </optgroup>
              <optgroup label="내 계정">
                {fromOptions.filter((o) => o.scope === "personal").map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
              </optgroup>
            </select>
            {fromOptions.find((o) => o.value === from)?.scope === "personal" && (
              <div className="mt-1.5 text-[11px] text-muted">
                {myNickEditing ? (
                  <span className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      className="input py-1 text-[12px] flex-1"
                      value={myNick}
                      onChange={(e) => setMyNick(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveMyFromName(); if (e.key === "Escape") setMyNickEditing(false); }}
                      placeholder="수신자에게 보일 이름"
                    />
                    <button type="button" onClick={saveMyFromName} className="chip hover:border-brand/40 shrink-0">저장</button>
                    <button type="button" onClick={() => setMyNickEditing(false)} className="chip shrink-0">취소</button>
                  </span>
                ) : (
                  <span>
                    수신자에게 <span className="font-mono text-text/80">{from.match(/^(.*?)\s*</)?.[1] || from}</span> 으로 표시됩니다.{" "}
                    <button
                      type="button"
                      className="text-brand hover:underline"
                      onClick={() => { setMyNick(from.match(/^(.*?)\s*</)?.[1] ?? ""); setMyNickEditing(true); }}
                    >
                      ✎ 이름 변경
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-[11px] text-muted mb-1">답장 받을 주소 (Reply-To)</label>
            <input className="input text-[13px]" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="비우면 발신자 주소로 회신" />
            <p className="mt-1 text-[10px] text-muted">비우면 회신이 <span className="font-mono">{from || "발신자"}</span> 주소로 갑니다. @{brand.auth.senderDomain} 주소만 허용.</p>
          </div>
          <label className="flex items-start gap-2 text-[12px] text-text/80 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={isAd} onChange={(e) => setIsAd(e.target.checked)} />
            <span>광고성 메일 (제목에 <span className="font-mono">(광고)</span> 자동 표기 · 정보통신망법). 외부 수신자 대상 홍보·행사 초청이면 체크.</span>
          </label>
        </section>
      </div>

      {/* ─────────── RIGHT: preview canvas ─────────── */}
      <div className="flex flex-col bg-surface2/40 min-h-0">
        <div className="px-6 py-3 border-b border-border flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="kicker">Preview Canvas</div>
            <h2 className="text-base font-bold truncate mt-0.5">{tmplObj?.subject || "이메일을 선택하세요"}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {previewUrl && (
              <>
                <a href={previewUrl} download={`${selected}.html`} className="btn-ghost text-xs" title="HTML 파일로 다운로드">⬇ HTML</a>
                <a href={previewUrl} target="_blank" rel="noreferrer" className="btn-ghost text-xs">새 탭 ↗</a>
              </>
            )}
            <button disabled={!canTest} onClick={() => runSend({ testToSelf: true })} className="btn-ghost text-xs" title={me ? `${me} 에게만 테스트 발송` : "로그인 필요"}>
              ✉ 나에게 테스트
            </button>
            <div className="relative group">
              <button
                disabled={!canSend}
                onClick={() => setConfirmOpen(true)}
                className="btn-primary !px-3 flex items-center gap-1.5"
                title={disabledReason || (sending ? "발송 중…" : `${validCount}명에게 발송`)}
                aria-label="발송"
              >
                {sending ? <SpinnerIcon /> : <SendIcon />}
                {!sending && validCount > 0 && <span className={`text-[12px] font-bold tabular-nums ${overCap ? "text-red-200" : ""}`}>{validCount}명</span>}
              </button>
              {disabledReason && !sending && (
                <div className="hidden group-hover:block absolute top-full mt-1 right-0 text-[11px] bg-bg border border-border rounded-lg px-2 py-1 whitespace-nowrap text-muted shadow z-10">{disabledReason}</div>
              )}
            </div>
          </div>
        </div>

        {notice && (
          <div className="mx-6 mt-3 text-[12px] text-amber-700 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2 flex items-start gap-2">
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice("")} className="text-muted hover:text-text shrink-0">✕</button>
          </div>
        )}

        {/* progress */}
        {sending && (
          <div className="px-6 pt-3 shrink-0">
            {total > 0 ? (
              <>
                <div className="flex justify-between text-[11px] text-muted mb-1">
                  <span>{processed} / {total}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-green-500">✓ {okCount}</span>
                    {failCount > 0 && <span className="text-red-500">✗ {failCount}</span>}
                    {currentSendId && (
                      <button onClick={abortSend} disabled={aborting} className="text-[11px] text-red-500 hover:underline disabled:opacity-50">
                        {aborting ? "중단 요청됨…" : "■ 발송 중단"}
                      </button>
                    )}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                  <div className="h-full bg-brand transition-all" style={{ width: `${progressPct}%` }} />
                </div>
              </>
            ) : (
              <div className="text-[11px] text-muted">서버에 연결 중…</div>
            )}
          </div>
        )}

        {/* canvas */}
        <div className="flex-1 min-h-0 p-6 overflow-auto flex justify-center">
          <div className="relative w-full max-w-[680px] h-full">
            <span className="absolute -top-1 -left-1 w-2.5 h-2.5 border-l-2 border-t-2 border-brand/40" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 border-r-2 border-t-2 border-brand/40" />
            <span className="absolute -bottom-1 -left-1 w-2.5 h-2.5 border-l-2 border-b-2 border-brand/40" />
            <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 border-r-2 border-b-2 border-brand/40" />
            {selected ? (
              <iframe key={selected} title="template-preview" src={previewUrl} sandbox="allow-same-origin" className="w-full h-full bg-white rounded-xl border border-border shadow-lg" />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted">이메일을 선택하면 여기에 미리보기가 표시됩니다</div>
            )}
          </div>
        </div>

        {/* result panel */}
        {events.length > 0 && (
          <div className="px-6 pb-3 shrink-0">
            <div className="card p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="kicker">발송 결과{infoEv?.kind === "test" ? " (테스트)" : ""}</div>
                  {doneEv && (
                    <div className="text-xs">
                      <span className="text-green-500">성공 {doneEv.ok}</span>
                      <span className="text-muted"> / </span>
                      <span className={doneEv.fail > 0 ? "text-red-500" : "text-muted"}>실패 {doneEv.fail}</span>
                      {doneEv.aborted && <span className="text-orange-500 ml-2">· 중단됨</span>}
                    </div>
                  )}
                  {doneEv?.failedEmails && doneEv.failedEmails.length > 0 && (
                    <button onClick={() => navigator.clipboard?.writeText(doneEv.failedEmails.join("\n"))} className="text-[11px] text-red-500 hover:underline" title="실패한 이메일 클립보드 복사">📋 실패 {doneEv.failedEmails.length}건 복사</button>
                  )}
                </div>
                <button onClick={() => { if (!sending) setEvents([]); }} disabled={sending} className="text-[11px] text-muted hover:text-text disabled:opacity-30">지우기</button>
              </div>
              {infoEv && (infoEv.excludedSuppressed ?? 0) > 0 && (
                <div className="text-[11px] text-amber-600 mb-1">· 수신거부/반송 {infoEv.excludedSuppressed}명 자동 제외됨</div>
              )}
              <div ref={resultRef} className="space-y-1 max-h-40 overflow-y-auto font-mono text-[11px]">
                {events.length > 200 && <div className="text-muted text-[10px]">… 이전 {events.length - 200}건 생략 (전체 결과는 발송 이력에서 확인)</div>}
                {events.slice(-200).map((e, idx) => <EventRow key={idx} e={e} />)}
              </div>
            </div>
          </div>
        )}
      </div>

      <AddTemplateDialog open={showAddHtml || !!htmlEditName} editName={htmlEditName} onClose={() => { setShowAddHtml(false); setHtmlEditName(null); }} onSaved={loadTemplates} />
      <TemplateComposer open={composer.open} editName={composer.editName} onClose={() => setComposer({ open: false, editName: null })} onSaved={() => loadTemplates()} />

      {quickAddOpen && (
        <ListEditor
          slug={null}
          me={me || null}
          onClose={() => setQuickAddOpen(false)}
          onSaved={onListsChanged}
        />
      )}

      {confirmOpen && (
        <ConfirmSendModal
          template={selected}
          subject={tmplObj?.subject || ""}
          isAd={isAd}
          from={from}
          replyTo={replyTo}
          listNames={selectedListNames}
          recipients={mergedRecipients}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => runSend()}
        />
      )}
    </div>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4.5 h-4.5" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function StepHead({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="step-badge">{n}</span>
      <h2 className="text-sm font-bold">{title}</h2>
    </div>
  );
}

function EventRow({ e }: { e: SendEvent }) {
  if (e.type === "info") {
    return (
      <div className="text-muted">
        ▶ {e.subject} → {e.valid}명 발송 시작
        {e.adhoc.duplicates.length > 0 && ` (중복 ${e.adhoc.duplicates.length} 제거)`}
        {e.adhoc.invalid.length > 0 && ` (형식오류 ${e.adhoc.invalid.length} 제외)`}
      </div>
    );
  }
  if (e.type === "ok") {
    return (
      <div className="text-green-500">
        ✓ <span className="text-text/90">{e.to}</span>{" "}
        <span className="text-muted text-[10px]">{e.id?.slice(0, 8) ?? ""}</span>
        <span className="text-muted text-[10px]"> · {e.i}/{e.total}</span>
      </div>
    );
  }
  if (e.type === "fail") {
    return <div className="text-red-500">✗ <span className="text-text/90">{e.to}</span> — {e.error}</div>;
  }
  return (
    <div className="text-brand mt-2 pt-2 border-t border-border">
      ━ {e.aborted ? "중단됨" : "완료"}: 성공 {e.ok} / 실패 {e.fail} / 총 {e.total}
    </div>
  );
}
