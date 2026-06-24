"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { brand } from "@/brand.config";

const ERROR_MSG: Record<string, string> = {
  domain: brand.ui.login.domainError,
  state: "세션이 만료되었습니다. 다시 시도해 주세요.",
  exchange: "구글 인증에 실패했습니다. 다시 시도해 주세요.",
  auth: "인증 정보가 없습니다. 다시 시도해 주세요.",
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh flex items-center justify-center text-muted">…</div>}>
      <LoginInner />
    </Suspense>
  );
}

function safeNext(next: string): string {
  // Prevent open redirects: only allow internal paths starting with a single slash.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function LoginInner() {
  const sp = useSearchParams();
  const next = safeNext(sp.get("next") || "/");
  const error = sp.get("error");
  const isPassword = brand.auth.mode === "password";

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="card p-8 w-full max-w-sm space-y-6 shadow-2xl">
        <div>
          <div className="kicker">Internal Tool</div>
          <h1 className="mt-1 text-xl font-semibold">{brand.ui.login.title}</h1>
          <p className="mt-1 text-[12px] text-muted">
            {isPassword ? brand.ui.login.passwordSubtitle : brand.ui.login.subtitle}
          </p>
        </div>

        {error && !isPassword && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {ERROR_MSG[error] ?? "로그인에 실패했습니다."}
          </div>
        )}

        {isPassword ? <PasswordForm next={next} /> : <GoogleButton next={next} />}
      </div>
    </div>
  );
}

function PasswordForm({ next }: { next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // The session cookie has been set. Navigate to the intended path.
        router.replace(next);
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setErr(data?.error || brand.ui.login.passwordError);
    } catch {
      setErr("요청에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        type="password"
        className="input"
        placeholder="비밀번호"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
        autoComplete="current-password"
      />
      {err && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {err}
        </div>
      )}
      <button type="submit" className="btn-primary w-full" disabled={loading || !password}>
        {loading ? "확인 중…" : "들어가기"}
      </button>
    </form>
  );
}

function GoogleButton({ next }: { next: string }) {
  return (
    <>
      <a
        href={`/api/auth/google?next=${encodeURIComponent(next)}`}
        className="flex items-center justify-center gap-2.5 w-full rounded-lg bg-white text-[#1f1f1f] border border-border font-semibold text-sm py-2.5 hover:bg-white/90 hover:border-brand/50 active:scale-[0.99] transition"
      >
        <GoogleMark />
        Google로 로그인
      </a>
      <p className="text-[11px] text-muted text-center">{brand.ui.login.domainNotice}</p>
    </>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
