"use client";

import { useState } from "react";
import { useTheme } from "./ThemeToggle";
import { useEscClose } from "./hooks";

export type UserProfile = { name?: string | null; picture?: string | null };

/**
 * 탑바 우측 프로필 메뉴 — 구글 프로필 원형 아바타를 누르면
 * 설정 / 테마 / 로그아웃 드롭다운이 열린다 (구 좌측 레일 대체).
 * 사진이 없거나 로드 실패하면 이니셜 아바타로 폴백.
 */
export default function ProfileMenu({
  me, profile, onOpenSettings, onLogout,
}: {
  me: string | null;
  profile: UserProfile | null;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const { theme, toggle } = useTheme();

  useEscClose(open, () => setOpen(false));

  const displayName = profile?.name?.trim() || me?.split("@")[0] || "";
  const showImg = !!profile?.picture && !imgError;

  function avatar(sizeCls: string, textCls: string) {
    return showImg ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profile!.picture!}
        alt={displayName}
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className={`${sizeCls} rounded-full object-cover`}
      />
    ) : (
      <span
        className={`${sizeCls} rounded-full inline-flex items-center justify-center font-bold text-onBrand ${textCls}`}
        style={{ backgroundImage: "linear-gradient(135deg, rgb(var(--brand-mint)), rgb(var(--brand-deep)))" }}
        aria-hidden
      >
        {(displayName || "?").charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`block rounded-full ring-2 transition ${open ? "ring-brand" : "ring-border hover:ring-brand/60"}`}
        title={me ?? "프로필"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {avatar("w-9 h-9", "text-sm")}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-64 card p-1.5" role="menu">
            <div className="flex items-center gap-3 px-2.5 py-2.5 border-b border-border mb-1.5">
              {avatar("w-10 h-10 shrink-0", "text-base")}
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-text truncate">{displayName || "…"}</div>
                <div className="text-[11px] text-muted truncate">{me ?? ""}</div>
              </div>
            </div>

            <MenuItem
              icon={<GearIcon />}
              label="설정"
              hint="발송 이력 · 예약 · 수신거부 · 발신자 · AI"
              onClick={() => { setOpen(false); onOpenSettings(); }}
            />
            <MenuItem
              icon={theme === "dark" ? <SunIcon /> : <MoonIcon />}
              label="테마"
              hint={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
              onClick={toggle}
            />
            <div className="my-1.5 border-t border-border" />
            <MenuItem
              icon={<LogoutIcon />}
              label="로그아웃"
              danger
              onClick={() => { setOpen(false); onLogout(); }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon, label, hint, danger = false, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface2 ${
        danger ? "text-red-500/90 hover:text-red-500" : "text-text/85 hover:text-text"
      }`}
    >
      <span className={`shrink-0 ${danger ? "" : "text-muted"}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && <span className="block text-[10px] text-muted truncate">{hint}</span>}
      </span>
    </button>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
