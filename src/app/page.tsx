"use client";

import { useCallback, useEffect, useState } from "react";
import SendForm, { type SendPrefill } from "@/components/SendForm";
import AdminSettings, { type SettingsTab } from "@/components/AdminSettings";
import ProfileMenu, { type UserProfile } from "@/components/ProfileMenu";
import GuideButton from "@/components/GuideButton";
import type { FollowupPayload } from "@/components/TrackingSidebar";
import { brand } from "@/brand.config";

/**
 * Main — below the top bar (brand + profile menu) is just the send screen (SendForm).
 * The old left rail's entry points moved to the send-screen popups (email/list) and
 * the profile menu (settings/theme/logout); the send log is a tab inside settings.
 */
export default function HomePage() {
  const [adminOpen, setAdminOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("history");
  const [sched, setSched] = useState<{ upcoming: number; problems: number }>({ upcoming: 0, problems: 0 });
  const [configReloadKey, setConfigReloadKey] = useState(0);
  const [me, setMe] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [prefill, setPrefill] = useState<SendPrefill>(null);
  const [prefillNonce, setPrefillNonce] = useState(0);

  function followup(p: FollowupPayload) {
    const n = prefillNonce + 1;
    setPrefillNonce(n);
    // Preserve names: fill in "홍길동 <a@b.com>" format so parseRecipientGrid maps names too.
    const adhoc = p.recipients
      .map((r) => (r.name?.trim() ? `${r.name.trim()} <${r.email}>` : r.email))
      .join("\n");
    setPrefill({ template: p.templateName, adhoc, isAd: p.isAd, from: p.from, replyTo: p.replyTo, force: true, followupOf: p.sourceSendId, nonce: n });
    setAdminOpen(false);
  }

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((j) => {
        setMe(j.me ?? null);
        setProfile(j.profile ?? null);
        setIsAdmin(!!j.isAdmin);
      })
      .catch(() => {});
  }, []);

  // Top-bar schedule badge: upcoming count + unacknowledged problems (missed, over limit, failed).
  const refreshSchedules = useCallback(() => {
    fetch("/api/schedules")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setSched({ upcoming: j.upcomingCount ?? 0, problems: j.problems ?? 0 }); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshSchedules();
    const t = setInterval(refreshSchedules, 60_000);
    return () => clearInterval(t);
  }, [refreshSchedules]);

  function openSettings(tab: SettingsTab) {
    setSettingsTab(tab);
    setAdminOpen(true);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  }

  return (
    <div className="h-dvh flex flex-col bg-bg">
      <header className="h-14 shrink-0 bg-surface border-b border-border flex items-center justify-between pl-6 pr-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundImage: "linear-gradient(135deg, rgb(var(--brand-mint)), rgb(var(--brand)))" }}
            aria-hidden
          />
          <span className="font-extrabold tracking-tight text-brand text-[15px]">{brand.ui.headerBrand}</span>
          <span className="w-px h-4 bg-border shrink-0" aria-hidden />
          <span className="text-muted text-sm font-medium truncate">{brand.identity.appName}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => openSettings("history")} className="btn-ghost text-[13px] py-1.5">발송 이력</button>
          <button
            onClick={() => openSettings("schedules")}
            className={`btn-ghost text-[13px] py-1.5 flex items-center gap-1.5 ${sched.problems > 0 ? "border-red-400/60 text-red-600" : ""}`}
            title="예약 발송 관리"
          >
            예약 발송
            {sched.upcoming > 0 && <span className="chip py-0 tabular-nums">예정 {sched.upcoming}</span>}
            {sched.problems > 0 && <span className="chip py-0 tabular-nums border-red-400/60 text-red-600">확인 필요 {sched.problems}</span>}
          </button>
          <GuideButton />
          <ProfileMenu
            me={me}
            profile={profile}
            onOpenSettings={() => openSettings("history")}
            onLogout={logout}
          />
        </div>
      </header>

      <main className="flex-1 min-h-0 px-4 py-3 lg:px-6 lg:py-4">
        <SendForm
          prefill={prefill}
          configReloadKey={configReloadKey}
          onScheduled={refreshSchedules}
          onOpenSchedules={() => openSettings("schedules")}
          onOpenHistory={() => openSettings("history")}
        />
      </main>

      <AdminSettings
        open={adminOpen}
        initialTab={settingsTab}
        isAdmin={isAdmin}
        onClose={() => { setAdminOpen(false); refreshSchedules(); }}
        onSchedulesChanged={refreshSchedules}
        onChanged={() => setConfigReloadKey((k) => k + 1)}
        onFollowup={followup}
      />
    </div>
  );
}
