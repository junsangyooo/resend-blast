"use client";

import { useEffect, useState } from "react";
import SendForm, { type SendPrefill } from "@/components/SendForm";
import TrackingSidebar, { type FollowupPayload } from "@/components/TrackingSidebar";
import ArchiveDialog from "@/components/ArchiveDialog";
import ListManager from "@/components/ListManager";
import AdminSettings from "@/components/AdminSettings";
import ThemeToggle from "@/components/ThemeToggle";
import { brand } from "@/brand.config";

export type ComposerState = { open: boolean; editName: string | null };

export default function HomePage() {
  const [trackOpen, setTrackOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerState>({ open: false, editName: null });
  const [showAddHtml, setShowAddHtml] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [listsReloadKey, setListsReloadKey] = useState(0);
  const [configReloadKey, setConfigReloadKey] = useState(0);
  const [me, setMe] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [prefill, setPrefill] = useState<SendPrefill>(null);
  const [prefillNonce, setPrefillNonce] = useState(0);
  const bumpReload = () => setReloadKey((k) => k + 1);
  const bumpListsReload = () => setListsReloadKey((k) => k + 1);

  function followup(p: FollowupPayload) {
    const n = prefillNonce + 1;
    setPrefillNonce(n);
    // Preserve names: fill in "홍길동 <a@b.com>" format so parseRecipientGrid maps names too.
    const adhoc = p.recipients
      .map((r) => (r.name?.trim() ? `${r.name.trim()} <${r.email}>` : r.email))
      .join("\n");
    setPrefill({ template: p.templateName, adhoc, isAd: p.isAd, from: p.from, replyTo: p.replyTo, force: true, nonce: n });
    setTrackOpen(false);
  }

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((j) => { setMe(j.me ?? null); setIsAdmin(!!j.isAdmin); })
      .catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  }

  return (
    <div className="h-dvh flex bg-bg">
      <nav className="w-[76px] shrink-0 bg-rail text-white flex flex-col items-center py-4 gap-1.5 relative">
        <button className="rail-btn rail-btn-active" title="작성" aria-current="page">
          <SendIcon />
          <span>작성</span>
        </button>

        <div className="relative">
          <button
            className={`rail-btn ${templateMenuOpen ? "rail-btn-active" : ""}`}
            onClick={() => setTemplateMenuOpen((o) => !o)}
            title="새 이메일 만들기"
            aria-expanded={templateMenuOpen}
          >
            <LayoutIcon />
            <span>이메일</span>
          </button>
          {templateMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setTemplateMenuOpen(false)} />
              <div className="absolute left-full top-0 ml-1.5 z-50 w-60 card p-1.5 text-left">
                <div className="px-2.5 py-1.5 text-[10px] tracking-[0.18em] uppercase text-muted font-bold">
                  새 이메일
                </div>
                <button
                  onClick={() => { setComposer({ open: true, editName: null }); setTemplateMenuOpen(false); }}
                  className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-surface2 transition flex items-start gap-2.5"
                >
                  <span className="text-brand mt-0.5 shrink-0"><LayoutIcon /></span>
                  <span>
                    <span className="block text-sm font-semibold text-text">블록으로 만들기</span>
                    <span className="block text-[11px] text-muted">블록을 쌓아 온브랜드 메일 제작</span>
                  </span>
                </button>
                <button
                  onClick={() => { setShowAddHtml(true); setTemplateMenuOpen(false); }}
                  className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-surface2 transition flex items-start gap-2.5"
                >
                  <span className="text-brand mt-0.5 shrink-0"><CodeIcon /></span>
                  <span>
                    <span className="block text-sm font-semibold text-text">HTML 직접 입력</span>
                    <span className="block text-[11px] text-muted">HTML 코드로 직접 작성</span>
                  </span>
                </button>
              </div>
            </>
          )}
        </div>

        <button className="rail-btn" onClick={() => setListsOpen(true)} title="수신자 리스트">
          <UsersIcon />
          <span>리스트</span>
        </button>

        <button className="rail-btn" onClick={() => setTrackOpen(true)} title="발송 로그">
          <HistoryIcon />
          <span>로그</span>
        </button>

        <button className="rail-btn" onClick={() => setArchiveOpen(true)} title="보관함">
          <BoxIcon />
          <span>보관함</span>
        </button>

        <button className="rail-btn" onClick={() => setAdminOpen(true)} title="설정 (수신거부·발신자)">
          <GearIcon />
          <span>설정</span>
        </button>

        <div className="mt-auto flex flex-col items-center gap-1.5">
          <button onClick={logout} className="rail-btn" title="로그아웃">
            <LogoutIcon />
            <span>로그아웃</span>
          </button>
          <ThemeToggle className="rail-icon-btn" />
        </div>
      </nav>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-surface border-b border-border flex items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <span className="font-extrabold tracking-tight text-brand text-[15px]">{brand.ui.headerBrand}</span>
            <span className="text-muted text-sm font-medium">{brand.identity.appName}</span>
          </div>
          <div className="text-xs text-muted">{me ?? ""}</div>
        </header>

        <main className="flex-1 min-h-0">
          <SendForm
            composer={composer}
            setComposer={setComposer}
            showAddHtml={showAddHtml}
            setShowAddHtml={setShowAddHtml}
            reloadKey={reloadKey}
            listsReloadKey={listsReloadKey}
            onTemplatesChanged={bumpReload}
            openListManager={() => setListsOpen(true)}
            onListsChanged={bumpListsReload}
            prefill={prefill}
            configReloadKey={configReloadKey}
          />
        </main>
      </div>

      <ArchiveDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        reloadKey={reloadKey}
        onChanged={bumpReload}
      />

      <ListManager
        open={listsOpen}
        onClose={() => setListsOpen(false)}
        me={me}
        isAdmin={isAdmin}
        onChanged={bumpListsReload}
      />

      <AdminSettings
        open={adminOpen}
        isAdmin={isAdmin}
        onClose={() => setAdminOpen(false)}
        onChanged={() => setConfigReloadKey((k) => k + 1)}
      />

      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${trackOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={() => setTrackOpen(false)}
      />
      <aside
        className={`fixed top-0 right-0 z-50 h-dvh w-[500px] max-w-[94vw] bg-bg border-l border-border shadow-2xl transition-transform duration-200 ${trackOpen ? "translate-x-0" : "translate-x-full"}`}
        aria-hidden={!trackOpen}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <h2 className="text-sm font-semibold">발송 현황</h2>
          <button onClick={() => setTrackOpen(false)} className="icon-btn" title="닫기">✕</button>
        </div>
        <div className="h-[calc(100dvh-49px)]">
          <TrackingSidebar active={trackOpen} reloadKey={reloadKey + listsReloadKey} onFollowup={followup} />
        </div>
      </aside>
    </div>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}
function LayoutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
function CodeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
    </svg>
  );
}
function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
