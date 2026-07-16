"use client";

import { useEffect, useState } from "react";
import SendForm, { type SendPrefill } from "@/components/SendForm";
import AdminSettings from "@/components/AdminSettings";
import ProfileMenu, { type UserProfile } from "@/components/ProfileMenu";
import type { FollowupPayload } from "@/components/TrackingSidebar";
import { brand } from "@/brand.config";

/**
 * Main — a top bar (brand + profile menu) with the send screen (SendForm) below.
 * The old left rail's entry points moved into send-screen popups (email/list) and the
 * profile menu (settings/theme/logout); send history is now a tab inside settings.
 */
export default function HomePage() {
  const [adminOpen, setAdminOpen] = useState(false);
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
    setPrefill({ template: p.templateName, adhoc, isAd: p.isAd, from: p.from, replyTo: p.replyTo, force: true, nonce: n });
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
        <ProfileMenu
          me={me}
          profile={profile}
          onOpenSettings={() => setAdminOpen(true)}
          onLogout={logout}
        />
      </header>

      <main className="flex-1 min-h-0 px-4 py-3 lg:px-6 lg:py-4">
        <SendForm prefill={prefill} configReloadKey={configReloadKey} />
      </main>

      <AdminSettings
        open={adminOpen}
        isAdmin={isAdmin}
        onClose={() => setAdminOpen(false)}
        onChanged={() => setConfigReloadKey((k) => k + 1)}
        onFollowup={followup}
      />
    </div>
  );
}
