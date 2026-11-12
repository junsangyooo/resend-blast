"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddTemplateDialog from "./AddTemplateDialog";
import CreateEmailDialog from "./CreateEmailDialog";
import EmailPickerDialog, { type PickerTemplate } from "./EmailPickerDialog";
import ListSelectDialog, { type ListRow } from "./ListSelectDialog";
import SenderDialog from "./SenderDialog";
import AdhocDialog from "./AdhocDialog";
import ListEditor from "./ListEditor";
import ConfirmSendModal, { type ConfirmResult } from "./ConfirmSendModal";
import SaveAsListDialog from "./SaveAsListDialog";
import { parseRecipientGrid, type Recipient } from "@/lib/recipients";
import { brand } from "@/brand.config";

type FromOption = { value: string; label: string; builtin?: boolean; scope?: "shared" | "personal"; owner?: string };

type SendEvent =
  | { type: "info"; sendId: string; kind?: string; template: string; subject: string; from: string; valid: number; excludedSuppressed?: number; excludedByList?: number; excludedManually?: number; adhoc: { invalid: string[]; duplicates: string[] } }
  | { type: "ok"; to: string; id?: string; i: number; total: number }
  | { type: "fail"; to: string; error: string; i: number; total: number }
  | { type: "skip"; to: string; reason: string; i: number; total: number }
  | { type: "done"; sendId: string; ok: number; fail: number; skipped?: number; aborted?: boolean; total: number; failedEmails: string[]; at: string };

/** Send-screen selections survive navigation (studio round-trips, reloads) for this browser tab. */
const STORE_KEY = "eb.sendform.v1";
type Persisted = {
  selected: string; selectedListSlugs: string[]; excludeListSlugs: string[];
  adhoc: string; from: string; replyTo: string; isAd: boolean;
};
function readPersisted(): Partial<Persisted> {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "{}") ?? {}; } catch { return {}; }
}

export type SendPrefill = {
  template?: string;
  adhoc?: string;
  /** On resend, inherit the original's ad flag, sender, and reply-to (compliance/consistency). */
  isAd?: boolean;
  from?: string;
  replyTo?: string;
  /** Bypass the 90-second idempotency dedupe block (intentional resend). */
  force?: boolean;
  /** Source send of this re-send (recorded as a follow-up). */
  followupOf?: string;
  nonce: number;
} | null;

type Props = {
  prefill?: SendPrefill;
  configReloadKey?: number;
  /** A send was scheduled — refresh the top-bar badge. */
  onScheduled?: () => void;
  onOpenSchedules?: () => void;
  onOpenHistory?: () => void;
};

/**
 * 발송 화면 — 좌측 3단계는 목록을 팝업으로 위임해 스크롤 없이 한 화면에 들어온다.
 * ① 이메일: 만들기(생성/업로드 팝업) 또는 목록에서 선택(전체 노출·생성자만 삭제)
 * ② 수신자: 리스트 만들기/선택(팝업에서 다중선택·수정·삭제) + 직접 입력(팝업)
 * ③ 발신: 내 계정으로 / 공용 발신자로(팝업 선택) + Reply-To·광고성
 */
export default function SendForm({ prefill, configReloadKey = 0, onScheduled, onOpenSchedules, onOpenHistory }: Props) {
  const [templates, setTemplates] = useState<PickerTemplate[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [lists, setLists] = useState<ListRow[]>([]);

  const [selectedListSlugs, setSelectedListSlugs] = useState<string[]>([]);
  const [excludeListSlugs, setExcludeListSlugs] = useState<string[]>([]);
  const [excludedListEmails, setExcludedListEmails] = useState<Set<string>>(new Set());
  const [listMembersPreview, setListMembersPreview] = useState<{ email: string; name?: string; company?: string; title?: string; listSlug: string }[]>([]);
  const [adhoc, setAdhoc] = useState("");

  const [fromOptions, setFromOptions] = useState<FromOption[]>([]);
  const [from, setFrom] = useState<string>("");
  const [fromDefault, setFromDefault] = useState<string>("");
  const [myNickEditing, setMyNickEditing] = useState(false);
  const [myNick, setMyNick] = useState("");
  const [replyTo, setReplyTo] = useState<string>("");
  const [isAd, setIsAd] = useState(false);
  const [forceNextSend, setForceNextSend] = useState(false); // 재발송 prefill 시 멱등성 우회 1회
  const [followupOf, setFollowupOf] = useState<string | undefined>(undefined);
  const [hydrated, setHydrated] = useState(false);
  /** Selected email's body has an unsubscribe link (null = unknown/loading). */
  const [hasUnsub, setHasUnsub] = useState<boolean | null>(null);
  const [saveList, setSaveList] = useState<{ rows: Recipient[]; replaceAdhoc: boolean } | null>(null);
  const [lastSendAdhoc, setLastSendAdhoc] = useState<Recipient[]>([]);
  const [me, setMe] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [maxRecipients, setMaxRecipients] = useState<number>(1000);

  const [sending, setSending] = useState(false);
  const [events, setEvents] = useState<SendEvent[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [currentSendId, setCurrentSendId] = useState<string | null>(null);
  const [aborting, setAborting] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [scheduledNotice, setScheduledNotice] = useState(false);

  // 팝업 상태 — 각 단계의 목록/입력 UI 는 전부 팝업으로 위임
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [listSelectOpen, setListSelectOpen] = useState(false);
  const [listEditor, setListEditor] = useState<{ slug: string | null } | null>(null);
  const [adhocOpen, setAdhocOpen] = useState(false);
  const [senderOpen, setSenderOpen] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);

  // Restore this tab's selections, then apply "?select=<id>" (studio "save" returns here with it).
  useEffect(() => {
    const p = readPersisted();
    if (p.selected) setSelected(p.selected);
    if (Array.isArray(p.selectedListSlugs)) setSelectedListSlugs(p.selectedListSlugs);
    if (Array.isArray(p.excludeListSlugs)) setExcludeListSlugs(p.excludeListSlugs);
    if (typeof p.adhoc === "string") setAdhoc(p.adhoc);
    if (p.from) setFrom(p.from);
    if (typeof p.replyTo === "string") setReplyTo(p.replyTo);
    if (typeof p.isAd === "boolean") setIsAd(p.isAd);
    try {
      const url = new URL(window.location.href);
      const sel = url.searchParams.get("select");
      if (sel) {
        setSelected(sel);
        url.searchParams.delete("select");
        window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const data: Persisted = { selected, selectedListSlugs, excludeListSlugs, adhoc, from, replyTo, isAd };
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
  }, [hydrated, selected, selectedListSlugs, excludeListSlugs, adhoc, from, replyTo, isAd]);

  useEffect(() => { loadTemplates(); loadLists(); }, []);
  useEffect(() => { loadConfig(); }, [configReloadKey]);

  // Apply prefill passed in from follow-up/resend, etc.
  useEffect(() => {
    if (!prefill) return;
    if (prefill.template) setSelected(prefill.template);
    // Re-send targets replace the whole recipient selection — a list left selected from an
    // earlier send would otherwise go out again to everyone on it.
    setSelectedListSlugs([]);
    setExcludeListSlugs([]);
    if (prefill.adhoc !== undefined) setAdhoc(prefill.adhoc);
    setFollowupOf(prefill.followupOf);
    if (prefill.isAd !== undefined) setIsAd(prefill.isAd);
    if (prefill.from) setFrom(prefill.from);
    if (prefill.replyTo !== undefined) setReplyTo(prefill.replyTo);
    if (prefill.force) setForceNextSend(true);
    setNotice(
      `재발송 대상 직접 입력 칸에 반영 · 기존 리스트 선택 해제 · 발신자·회신${prefill.isAd ? "·광고성" : ""} 설정 원본 유지`
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
  // For your own address (differing only in display name), remap to your personal option rather than the default sender.
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
      ? "원본 발신 이름 사용 불가 · 내 계정 발신자로 대체"
      : "선택한 발신자 사용 불가 · 기본 발신자로 대체";
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

  function editTemplate(name: string) {
    window.location.href = `/studio?edit=${encodeURIComponent(name)}`;
  }

  // 선택된 리스트들의 멤버 프리뷰 — 선택 순서 유지 (동일 주소는 먼저 선택한 리스트 이름 우선)
  // + 제외 리스트의 멤버(이번 발송에서 뺄 주소)
  const membersSeq = useRef(0);
  /** (Re)load members of selected + excluded lists. Also called right before the confirm screen opens,
   *  because anyone may add members to a list while this page sits open. */
  const fetchMembers = useCallback(async () => {
    const my = ++membersSeq.current;
    const all = [...selectedListSlugs, ...excludeListSlugs];
    if (all.length === 0) { setListMembersPreview([]); setExcludedListEmails(new Set()); return; }
    const qs = `with=members&slugs=${all.map(encodeURIComponent).join(",")}`;
    const r = await fetch(`/api/lists?${qs}`).catch(() => null);
    if (!r || !r.ok) return;
    const j = await r.json();
    if (my !== membersSeq.current) return; // a newer load superseded this one
    const bySlug = new Map<string, any>((j.lists ?? []).map((l: any) => [l.slug, l]));
    const collected: { email: string; name?: string; company?: string; title?: string; listSlug: string }[] = [];
    for (const slug of selectedListSlugs) {
      for (const m of bySlug.get(slug)?.members ?? []) collected.push({ email: m.email, name: m.name, company: m.company, title: m.title, listSlug: slug });
    }
    const excl = new Set<string>();
    for (const slug of excludeListSlugs) for (const m of bySlug.get(slug)?.members ?? []) excl.add(String(m.email).toLowerCase());
    setListMembersPreview(collected);
    setExcludedListEmails(excl);
  }, [selectedListSlugs, excludeListSlugs]);

  useEffect(() => { fetchMembers(); }, [fetchMembers, lists]);

  async function openConfirm() {
    await fetchMembers();
    setConfirmOpen(true);
  }

  // 선택한 이메일 본문에 수신거부 링크가 있는지 (광고성 발송 안내용)
  useEffect(() => {
    setHasUnsub(null);
    if (!selected) return;
    let cancel = false;
    fetch(`/api/templates?built=${encodeURIComponent(selected)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancel && j?.html) setHasUnsub(String(j.html).includes("%%UNSUB_URL%%")); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [selected]);

  const tmplObj = templates.find((t) => t.name === selected);

  // 직접 입력은 텍스트가 단일 소스 — 팝업이 닫혀 있어도(재발송 prefill 등) 항상 파싱 결과가 최신.
  const adhocRows = useMemo(() => parseRecipientGrid(adhoc).rows, [adhoc]);

  const mergedRecipients = useMemo(() => {
    const seen = new Set<string>(excludedListEmails);
    const out: { email: string; name?: string; company?: string; title?: string; source: string }[] = [];
    for (const m of listMembersPreview) {
      const e = m.email.toLowerCase();
      if (seen.has(e)) continue;
      seen.add(e);
      out.push({ email: e, name: m.name, company: m.company, title: m.title, source: m.listSlug });
    }
    for (const r of adhocRows) {
      const e = r.email.toLowerCase();
      if (seen.has(e)) continue;
      seen.add(e);
      out.push({ email: e, name: r.name, company: r.company, title: r.title, source: "ad-hoc" });
    }
    return out;
  }, [listMembersPreview, adhocRows, excludedListEmails]);

  // 제외 리스트 때문에 빠지는 인원 (선택·직접 입력에 있던 사람 중)
  const excludedCount = useMemo(() => {
    if (excludedListEmails.size === 0) return 0;
    const all = new Set([...listMembersPreview.map((m) => m.email.toLowerCase()), ...adhocRows.map((r) => r.email.toLowerCase())]);
    let n = 0;
    all.forEach((e) => { if (excludedListEmails.has(e)) n++; });
    return n;
  }, [excludedListEmails, listMembersPreview, adhocRows]);

  // 리스트만의 중복 제거 인원 (리스트 선택 팝업의 합계 요약용)
  const listUniqueCount = useMemo(
    () => new Set(listMembersPreview.map((m) => m.email.toLowerCase())).size,
    [listMembersPreview]
  );

  const validCount = mergedRecipients.length;
  const overCap = validCount > maxRecipients;

  let disabledReason = "";
  if (!selected) disabledReason = "① 이메일 선택";
  else if (validCount === 0) disabledReason = excludedCount > 0 ? "제외 리스트 적용 후 수신자 없음" : "② 수신자 선택";
  else if (overCap) disabledReason = `1회 최대 ${maxRecipients}명 초과 (현재 ${validCount}명)`;
  else if (!from) disabledReason = "③ 발신자 선택";
  const canSend = !disabledReason && !sending;
  const canTest = !!selected && !!me && !sending;

  async function runSend(opts?: { testToSelf?: boolean } & ConfirmResult) {
    const testToSelf = !!opts?.testToSelf;
    const scheduledAt = testToSelf ? undefined : opts?.scheduledAt;
    setSending(true);
    setEvents([]);
    setConfirmOpen(false);
    setCurrentSendId(null);
    setNotice("");
    setScheduledNotice(false);
    try {
      const r = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: selected,
          listSlugs: testToSelf ? [] : selectedListSlugs,
          excludeListSlugs: testToSelf ? [] : excludeListSlugs,
          adhoc: testToSelf ? "" : adhoc,
          excludeEmails: testToSelf ? [] : (opts?.excludeEmails ?? []),
          // What the confirm screen showed; the server refuses if a list changed in between.
          expectedEmails: testToSelf ? undefined : mergedRecipients.map((m) => m.email),
          from, replyTo, isAd,
          force: testToSelf ? false : forceNextSend,
          followupOf: testToSelf ? undefined : followupOf,
          scheduledAt,
          testToSelf,
        }),
      });
      if (r.status === 401) { location.href = "/login"; return; }
      if (!r.ok && r.headers.get("content-type")?.includes("json")) {
        const j = await r.json();
        if (j.duplicate) { setNotice(j.error ?? "중복 발송이 차단되었습니다."); return; }
        if (j.recipientsChanged) { setNotice(j.error); await fetchMembers(); return; }
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      if (scheduledAt) {
        const j = await r.json();
        setNotice(`예약 완료 · ${j.scheduledAtKst} KST · ${j.recipients}명`);
        setScheduledNotice(true);
        setForceNextSend(false);
        setFollowupOf(undefined);
        onScheduled?.();
        return;
      }
      if (!testToSelf) setLastSendAdhoc(adhocRows);
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
      if (!testToSelf) { setForceNextSend(false); setFollowupOf(undefined); } // 재발송 표시·멱등성 우회는 1회만
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
  const excludedLists = excludeListSlugs
    .map((slug) => lists.find((l) => l.slug === slug))
    .filter((l): l is ListRow => !!l);

  function defaultListName(): string {
    const d = new Date();
    return `${tmplObj?.title ?? "직접 입력"} 수신자 ${d.getMonth() + 1}/${d.getDate()}`;
  }
  /** Turn the ad-hoc recipients into a saved list and select it instead (same recipients). */
  function onAdhocSavedAsList(slug: string, clearAdhoc: boolean) {
    setSelectedListSlugs((cur) => (cur.includes(slug) ? cur : [...cur, slug]));
    if (clearAdhoc) setAdhoc("");
    loadLists();
  }

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
      {/* ─────────── LEFT: 3단계 설정 — 스크롤 없이 한 화면 ─────────── */}
      <div className="lg:border-r border-border bg-surface p-5 flex flex-col gap-6 overflow-y-auto">
        {/* ① 이메일 */}
        <section className="space-y-2.5">
          <StepHead n={1} title="이메일 선택" />
          <p className="text-[12px] text-muted truncate">
            팀원 이메일 포함 · 복제 가능
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
                  <span className="text-[13px] font-semibold text-text/90 truncate">{tmplObj.title}</span>
                  {tmplObj.composed && <span className="chip shrink-0">블록</span>}
                </div>
                <div className="text-[12px] text-text/70 mt-1 truncate">제목: {tmplObj.subject}</div>
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
                총 <b className={overCap ? "text-red-500" : "text-brand"}>{validCount}</b>명 · 중복 제외{excludedCount > 0 ? ` · 제외 리스트로 ${excludedCount}명 뺌` : ""}{overCap ? ` · 최대 ${maxRecipients}` : ""}
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
            {excludedLists.map((l) => (
              <span key={l.slug} className="chip border-red-400/50 text-red-600" title="해당 리스트의 인원은 발송 대상에서 제외됩니다">
                <span className="truncate max-w-[120px]">제외: {l.name}</span>
                <button
                  onClick={() => setExcludeListSlugs((cur) => cur.filter((s) => s !== l.slug))}
                  className="text-muted hover:text-red-500"
                  title="제외 해제"
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
            <span className="truncate">광고성 메일 (제목에 (광고) 자동 표기)</span>
          </label>
          {isAd && hasUnsub === false && (
            <p className="text-[12px] text-amber-700 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2.5 py-1.5 leading-relaxed">
              수신거부 링크 없음 · 하단에 기본 수신거부 문구 자동 추가
            </p>
          )}
        </section>
      </div>

      {/* ─────────── RIGHT: preview canvas ─────────── */}
      <div className="flex flex-col bg-surface2/40 min-h-0">
        <div className="px-6 py-3 border-b border-border flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="kicker">Preview Canvas</div>
            <h2 className="text-base font-bold truncate mt-0.5">{tmplObj ? tmplObj.title : "이메일을 선택하세요"}</h2>
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
            <button
              disabled={!canSend}
              onClick={openConfirm}
              className="btn-primary !px-3 flex items-center gap-1.5"
              title={disabledReason || (sending ? "발송 중…" : `${validCount}명에게 발송 또는 예약`)}
            >
              {sending ? <SpinnerIcon /> : <SendIcon />}
              <span className="text-[13px] font-bold tabular-nums">
                {sending ? "발송 중…" : validCount > 0 ? `${validCount}명에게 발송` : "발송"}
              </span>
            </button>
          </div>
        </div>
        {disabledReason && !sending && (
          <div className="px-6 py-1.5 border-b border-border text-[12px] text-amber-700 bg-amber-400/5 text-right shrink-0">
            필요: <b>{disabledReason}</b>
          </div>
        )}

        {notice && (
          <div className={`mx-6 mt-3 text-[12px] rounded-lg px-3 py-2 flex items-start gap-2 ${scheduledNotice ? "text-brand bg-brand/10 border border-brand/30" : "text-amber-700 bg-amber-400/10 border border-amber-400/30"}`}>
            <span className="flex-1">{notice}</span>
            {scheduledNotice && onOpenSchedules && (
              <button onClick={onOpenSchedules} className="underline shrink-0">예약 발송 보기</button>
            )}
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
                <span className="flex items-center gap-3">
                  {doneEv && onOpenHistory && infoEv?.kind !== "test" && (
                    <button onClick={onOpenHistory} className="text-[12px] text-brand hover:underline">발송 이력에서 보기</button>
                  )}
                  <button onClick={() => { if (!sending) setEvents([]); }} disabled={sending} className="text-[12px] text-muted hover:text-text disabled:opacity-30">지우기</button>
                </span>
              </div>
              {infoEv && (infoEv.excludedSuppressed ?? 0) > 0 && (
                <div className="text-[12px] text-amber-600 mb-1">· 수신거부/반송 {infoEv.excludedSuppressed}명 자동 제외됨</div>
              )}
              {doneEv && infoEv?.kind !== "test" && lastSendAdhoc.length > 0 && (
                <div className="text-[12px] mb-1.5 flex items-center gap-2 rounded-lg bg-brand/5 border border-brand/20 px-2.5 py-1.5">
                  <span className="flex-1">직접 입력 {lastSendAdhoc.length}명</span>
                  <button className="text-brand underline shrink-0" onClick={() => setSaveList({ rows: lastSendAdhoc, replaceAdhoc: false })}>리스트로 저장</button>
                </div>
              )}
              <div ref={resultRef} className="space-y-1 max-h-40 overflow-y-auto font-mono text-[11px]">
                {events.length > 200 && <div className="text-muted text-[10px]">… 이전 {events.length - 200}건 생략 (전체 결과는 발송 이력에서 확인)</div>}
                {events.slice(-200).map((e, idx) => <EventRow key={idx} e={e} />)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─────────── 팝업들 ─────────── */}
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
        onChanged={async (selectName) => { await loadTemplates(); if (selectName) setSelected(selectName); }}
        onClose={() => setPickerOpen(false)}
      />

      <ListSelectDialog
        open={listSelectOpen}
        lists={lists}
        selected={selectedListSlugs}
        excluded={excludeListSlugs}
        onExcludeChange={setExcludeListSlugs}
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
        onSaveAsList={() => { setAdhocOpen(false); setSaveList({ rows: adhocRows, replaceAdhoc: true }); }}
        onClose={() => setAdhocOpen(false)}
      />

      {saveList && (
        <SaveAsListDialog
          rows={saveList.rows}
          defaultName={defaultListName()}
          // From the ad-hoc popup the list replaces the typed text; after a finished send nothing else changes.
          onSaved={(slug) => { if (saveList.replaceAdhoc) onAdhocSavedAsList(slug, true); else loadLists(); setLastSendAdhoc([]); }}
          onClose={() => setSaveList(null)}
        />
      )}

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
          templateTitle={tmplObj?.title ?? selected}
          subject={tmplObj?.subject || ""}
          isAd={isAd}
          from={from}
          replyTo={replyTo}
          listNames={selectedListNames}
          excludedListNames={excludedLists.map((l) => l.name)}
          excludedByListCount={excludedCount}
          recipients={mergedRecipients}
          onClose={() => setConfirmOpen(false)}
          onConfirm={(res: ConfirmResult) => { runSend(res); }}
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
        {(e.excludedByList ?? 0) > 0 && ` (제외 리스트 ${e.excludedByList} 뺌)`}
        {(e.excludedManually ?? 0) > 0 && ` (이미 받은 사람 ${e.excludedManually} 뺌)`}
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
  if (e.type === "skip") {
    return <div className="text-amber-600">– <span className="text-text/90">{e.to}</span> — {e.reason}</div>;
  }
  return (
    <div className="text-brand mt-2 pt-2 border-t border-border">
      ━ {e.aborted ? "중단됨" : "완료"}: 성공 {e.ok} / 실패 {e.fail}{(e.skipped ?? 0) > 0 ? ` / 미발송 ${e.skipped}` : ""} / 총 {e.total}
    </div>
  );
}
