"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AddTemplateDialog from "./AddTemplateDialog";
import CreateEmailDialog from "./CreateEmailDialog";
import EmailPickerDialog, { type PickerTemplate } from "./EmailPickerDialog";
import ListSelectDialog, { type ListRow } from "./ListSelectDialog";
import SenderDialog from "./SenderDialog";
import AdhocDialog from "./AdhocDialog";
import ListEditor from "./ListEditor";
import ConfirmSendModal from "./ConfirmSendModal";
import { parseRecipientGrid } from "@/lib/recipients";
import { brand } from "@/brand.config";

type FromOption = { value: string; label: string; builtin?: boolean; scope?: "shared" | "personal"; owner?: string };

type SendEvent =
  | { type: "info"; sendId: string; kind?: string; template: string; subject: string; from: string; valid: number; excludedSuppressed?: number; adhoc: { invalid: string[]; duplicates: string[] } }
  | { type: "ok"; to: string; id?: string; i: number; total: number }
  | { type: "fail"; to: string; error: string; i: number; total: number }
  | { type: "done"; sendId: string; ok: number; fail: number; aborted?: boolean; total: number; failedEmails: string[]; at: string };

export type SendPrefill = {
  template?: string;
  adhoc?: string;
  /** On resend, inherit the original's ad flag, sender, and reply-to (compliance/consistency). */
  isAd?: boolean;
  from?: string;
  replyTo?: string;
  /** Bypass the 90-second idempotency dedupe block (intentional resend). */
  force?: boolean;
  nonce: number;
} | null;

type Props = {
  prefill?: SendPrefill;
  configReloadKey?: number;
};

/**
 * Send screen — the left 3 steps delegate their lists to popups so everything fits on
 * one screen without scrolling.
 * ① Email: create (block composer / upload popup) or pick from the list (everyone sees
 *    everything, only the creator can delete)
 * ② Recipients: create/select a list (popup: multi-select + inline edit/delete) + ad-hoc (popup)
 * ③ Sender: my account / shared sender (popup) + Reply-To · ad flag
 */
export default function SendForm({ prefill, configReloadKey = 0 }: Props) {
  const [templates, setTemplates] = useState<PickerTemplate[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [lists, setLists] = useState<ListRow[]>([]);

  const [selectedListSlugs, setSelectedListSlugs] = useState<string[]>([]);
  const [listMembersPreview, setListMembersPreview] = useState<{ email: string; name?: string; listSlug: string }[]>([]);
  const [adhoc, setAdhoc] = useState("");

  const [fromOptions, setFromOptions] = useState<FromOption[]>([]);
  const [from, setFrom] = useState<string>("");
  const [fromDefault, setFromDefault] = useState<string>("");
  const [myNickEditing, setMyNickEditing] = useState(false);
  const [myNick, setMyNick] = useState("");
  const [replyTo, setReplyTo] = useState<string>("");
  const [isAd, setIsAd] = useState(false);
  const [forceNextSend, setForceNextSend] = useState(false); // bypass idempotency once on resend prefill
  const [me, setMe] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [maxRecipients, setMaxRecipients] = useState<number>(1000);

  const [sending, setSending] = useState(false);
  const [events, setEvents] = useState<SendEvent[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [currentSendId, setCurrentSendId] = useState<string | null>(null);
  const [aborting, setAborting] = useState(false);
  const [notice, setNotice] = useState<string>("");

  // Popup state — every step's list/input UI is delegated to a popup.
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [listSelectOpen, setListSelectOpen] = useState(false);
  const [listEditor, setListEditor] = useState<{ slug: string | null } | null>(null);
  const [adhocOpen, setAdhocOpen] = useState(false);
  const [senderOpen, setSenderOpen] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadTemplates(); loadLists(); }, []);
  useEffect(() => { loadConfig(); }, [configReloadKey]);

  // Apply prefill passed in from follow-up/resend, etc.
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

  // Warn before leaving the page during a send
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
    const list: PickerTemplate[] = j.templates || [];
    setTemplates(list);
    // If the selected email was deleted, clear it (no auto-select — selection is always explicit).
    setSelected((cur) => (cur && list.some((t) => t.name === cur) ? cur : ""));
  }

  async function loadLists() {
    const r = await fetch("/api/lists");
    if (!r.ok) return;
    const j = await r.json();
    setLists(j.lists ?? []);
  }

  async function loadConfig() {
    const r = await fetch("/api/config");
    if (r.status === 401) { location.href = "/login"; return; }
    const j = await r.json();
    const opts: FromOption[] = j.fromOptions ?? [];
    setFromOptions(opts);
    setFromDefault(j.fromDefault ?? "");
    // Keep the current selection if still valid (preserved even when an admin adds/removes senders), otherwise use the default.
    setFrom((cur) => (cur && opts.some((o) => o.value === cur) ? cur : (j.fromDefault ?? "")));
    setMe(j.me ?? "");
    setIsAdmin(!!j.isAdmin);
    setMaxRecipients(j.maxRecipients ?? 1000);
  }

  // Safety net: correct the `from` if one passed in via prefill (resend inheritance) etc. is no longer usable.
  // (Since the server rejects unregistered senders with 400, fix it here in advance instead of silently sending wrong.)
  // For your own address (differing only in display name), remap to your personal option rather than launch@.
  useEffect(() => {
    if (!from || fromOptions.length === 0) return;
    if (fromOptions.some((o) => o.value === from)) return;
    const addrMatch = from.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/)?.[1]?.toLowerCase() ?? (from.includes("@") ? from.toLowerCase() : null);
    const myOption = addrMatch && me && addrMatch === me.toLowerCase()
      ? fromOptions.find((o) => o.scope === "personal")
      : undefined;
    const next = myOption?.value || fromDefault || fromOptions[0]?.value || "";
    setFrom(next);
    // Append rather than overwrite an existing notice (e.g. the resend guidance).
    const msg = myOption
      ? "원본 발신 이름을 사용할 수 없어 내 계정 발신자로 대체했습니다."
      : "선택했던 발신자를 사용할 수 없어 기본 발신자로 대체했습니다. 발송 전 발신자를 확인하세요.";
    setNotice((prev) => (prev ? `${prev} ⚠ ${msg}` : `⚠ ${msg}`));
  }, [from, fromOptions, fromDefault, me]);

  // Save your own account's sender name (nickname) — registered as a personal sender and kept from then on.
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

  // Edit an email — studio handles both composed-spec and raw-HTML cases itself.
  function editTemplate(name: string) {
    window.location.href = `/studio?edit=${encodeURIComponent(name)}`;
  }

  // Member preview for the selected lists — preserves selection order (same address in multiple
  // lists keeps the first-selected list's name).
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
  }, [selectedListSlugs, lists]);

  const tmplObj = templates.find((t) => t.name === selected);

  // Ad-hoc text is the single source — parsed straight from it even while the popup is closed
  // (e.g. resend prefill) so the row count is always current.
  const adhocRows = useMemo(() => parseRecipientGrid(adhoc).rows, [adhoc]);

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

  // Deduped member count for the lists alone (for the list-picker popup's summary).
  const listUniqueCount = useMemo(
    () => new Set(listMembersPreview.map((m) => m.email.toLowerCase())).size,
    [listMembersPreview]
  );

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
      if (!testToSelf) setForceNextSend(false); // idempotency bypass applies only once, right after a resend
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

  const selectedLists = selectedListSlugs
    .map((slug) => lists.find((l) => l.slug === slug))
    .filter((l): l is ListRow => !!l);
  const selectedListNames = selectedLists.map((l) => l.name);

  const sharedOptions = fromOptions.filter((o) => o.scope !== "personal");
  const myOption = fromOptions.find((o) => o.scope === "personal");
  const isPersonalFrom = fromOptions.find((o) => o.value === from)?.scope === "personal";
  const fromDisplayName = from.match(/^(.*?)\s*</)?.[1]?.trim() || from;

  function clearAdhoc() {
    setAdhoc("");
  }

  const segActive = "btn text-xs justify-center py-2 border border-brand bg-brand/10 text-brand";
  const segIdle = "btn-ghost text-xs justify-center py-2";

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] card overflow-hidden">
      {/* ─────────── LEFT: 3 steps — fits on one screen without scrolling ─────────── */}
      <div className="lg:border-r border-border bg-surface p-5 flex flex-col gap-6 overflow-y-auto">
        {/* ① Email */}
        <section className="space-y-2.5">
          <StepHead n={1} title="이메일 선택" />
          <p className="text-[11px] text-muted truncate">
            💡 팀원이 만든 이메일까지 모두 목록에 보여요 · 삭제는 만든 사람만
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setCreateOpen(true)} className="btn-ghost text-xs justify-center py-2">
              ＋ 새로 만들기
            </button>
            <button
              onClick={() => { loadTemplates(); setPickerOpen(true); }}
              className="btn-ghost text-xs justify-center py-2"
            >
              목록에서 선택{templates.length > 0 && ` (${templates.length})`}
            </button>
          </div>
          {tmplObj ? (
            <div className="relative rounded-xl border border-brand bg-brand/5 ring-1 ring-brand/30">
              <button onClick={() => setPickerOpen(true)} className="w-full text-left p-3 pr-10" title="다른 이메일 선택">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[12px] text-text/90 truncate">{tmplObj.name}</span>
                  {tmplObj.composed && <span className="chip shrink-0">블록</span>}
                </div>
                <div className="text-[12px] text-text/70 mt-1 truncate">{tmplObj.subject}</div>
              </button>
              <button
                onClick={() => editTemplate(tmplObj.name)}
                title="스튜디오에서 수정"
                className="icon-btn absolute top-2.5 right-2 text-muted/60 hover:text-brand"
              >
                <EditIcon />
              </button>
            </div>
          ) : templates.length === 0 ? (
            <div className="text-[12px] text-muted py-4 px-4 text-center border border-dashed border-border rounded-xl leading-relaxed">
              <span className="text-text/80 font-semibold">처음이신가요?</span>{" "}
              <span className="text-brand">새로 만들기</span>로 첫 이메일을 만든 뒤 수신자를 정해 발송하세요.
              먼저 ✉ 나에게 테스트를 권장합니다.
            </div>
          ) : (
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full text-[12px] text-muted py-4 text-center border border-dashed border-border rounded-xl hover:border-brand/40 hover:text-text transition"
            >
              아직 선택된 이메일이 없습니다 — 목록에서 선택하세요
            </button>
          )}
        </section>

        {/* ② Recipients */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <StepHead n={2} title="수신자" />
            {validCount > 0 && (
              <span className="text-[11px] text-muted tabular-nums">
                총 <b className={overCap ? "text-red-500" : "text-brand"}>{validCount}</b>명 · 중복 제외{overCap ? ` · 최대 ${maxRecipients}` : ""}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setListEditor({ slug: null })} className="btn-ghost text-xs justify-center py-2">
              ＋ 리스트 만들기
            </button>
            <button
              onClick={() => { loadLists(); setListSelectOpen(true); }}
              className="btn-ghost text-xs justify-center py-2"
            >
              리스트 선택{selectedListSlugs.length > 0 && ` (${selectedListSlugs.length})`}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedLists.map((l) => (
              <span key={l.slug} className="chip">
                <span className="truncate max-w-[120px]">{l.name}</span>
                <span className="text-muted tabular-nums">{l.memberCount}</span>
                <button
                  onClick={() => setSelectedListSlugs((cur) => cur.filter((s) => s !== l.slug))}
                  className="text-muted hover:text-red-500"
                  title="선택 해제"
                >✕</button>
              </span>
            ))}
            {adhocRows.length > 0 ? (
              <span className="chip border-brand/40">
                <button onClick={() => setAdhocOpen(true)} className="hover:text-brand" title="직접 입력 수정">
                  ✎ 직접 입력 {adhocRows.length}명
                </button>
                <button onClick={clearAdhoc} className="text-muted hover:text-red-500" title="직접 입력 비우기">✕</button>
              </span>
            ) : (
              <button
                onClick={() => setAdhocOpen(true)}
                className="chip border-dashed text-muted hover:text-brand hover:border-brand/40 transition"
              >
                ＋ 직접 입력
              </button>
            )}
          </div>
        </section>

        {/* ③ Sender options */}
        <section className="space-y-2.5">
          <StepHead n={3} title="발신 옵션" />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { if (myOption) setFrom(myOption.value); }}
              disabled={!myOption}
              className={isPersonalFrom ? segActive : segIdle}
              title={me ? `${me} 주소로 발송` : "로그인 정보 확인 중"}
            >
              내 계정으로
            </button>
            <button
              onClick={() => setSenderOpen(true)}
              className={!isPersonalFrom ? segActive : segIdle}
              title="공용 발신자 선택"
            >
              공용 발신자로
            </button>
          </div>

          <div className="rounded-lg border border-border bg-surface2/40 px-3 py-2 text-[12px]">
            {isPersonalFrom ? (
              myNickEditing ? (
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
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <b className="text-text/90">{fromDisplayName}</b>
                    <span className="font-mono text-muted"> &lt;{me}&gt;</span>
                  </span>
                  <button
                    type="button"
                    className="text-brand hover:underline shrink-0"
                    onClick={() => { setMyNick(fromDisplayName === from ? "" : fromDisplayName); setMyNickEditing(true); }}
                  >
                    ✎ 이름 변경
                  </button>
                </span>
              )
            ) : (
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono truncate" title={from}>{from || "발신자를 선택하세요"}</span>
                <button type="button" onClick={() => setSenderOpen(true)} className="text-brand hover:underline shrink-0">변경</button>
              </span>
            )}
          </div>

          <div>
            <label className="block text-[11px] text-muted mb-1">답장 받을 주소 (@{brand.auth.senderDomain})</label>
            <input
              className="input py-1.5 text-[13px]"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="비우면 발신자 주소로 회신"
            />
          </div>

          <label
            className="flex items-center gap-2 text-[12px] text-text/80 cursor-pointer"
            title="제목에 (광고) 자동 표기 (정보통신망법). 외부 수신자 대상 홍보·행사 초청이면 체크."
          >
            <input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)} />
            <span className="truncate">광고성 메일 (제목에 자동 표기)</span>
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

      {/* ─────────── popups ─────────── */}
      <CreateEmailDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onUpload={() => { setCreateOpen(false); setUploadOpen(true); }}
      />

      <AddTemplateDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSaved={(savedName) => { loadTemplates(); if (savedName) setSelected(savedName); }}
      />

      <EmailPickerDialog
        open={pickerOpen}
        templates={templates}
        selected={selected}
        me={me}
        isAdmin={isAdmin}
        onSelect={(name) => { setSelected(name); setPickerOpen(false); }}
        onEdit={editTemplate}
        onChanged={loadTemplates}
        onClose={() => setPickerOpen(false)}
      />

      <ListSelectDialog
        open={listSelectOpen}
        lists={lists}
        selected={selectedListSlugs}
        dedupedCount={listUniqueCount}
        me={me}
        isAdmin={isAdmin}
        onChange={setSelectedListSlugs}
        onEdit={(slug) => setListEditor({ slug })}
        onCreate={() => setListEditor({ slug: null })}
        onChanged={loadLists}
        onClose={() => setListSelectOpen(false)}
      />

      {listEditor && (
        <ListEditor
          slug={listEditor.slug}
          me={me || null}
          isAdmin={isAdmin}
          onClose={() => setListEditor(null)}
          onSaved={(created) => {
            // Auto-select a newly created list as a recipient.
            if (created?.slug) {
              setSelectedListSlugs((cur) => (cur.includes(created.slug) ? cur : [...cur, created.slug]));
            }
            loadLists();
          }}
        />
      )}

      <AdhocDialog
        open={adhocOpen}
        value={adhoc}
        count={adhocRows.length}
        onTextChange={setAdhoc}
        onClose={() => setAdhocOpen(false)}
      />

      <SenderDialog
        open={senderOpen}
        options={sharedOptions}
        current={from}
        onSelect={setFrom}
        onClose={() => setSenderOpen(false)}
      />

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
