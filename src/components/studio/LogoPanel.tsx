"use client";
// 블록 이메일 로고 설정 (스튜디오 상단 '로고 ▾' 팝오버). 로고 목록·표시 여부·로고 아래 한 줄.
import { useEffect, useState } from "react";
import type { TemplateSpec } from "@/lib/blocks";
import { brand } from "@/brand.config";

export type Logo = { id: string; label: string; url: string; width: number };

export default function LogoPanel({ spec, onPatch }: {
  spec: TemplateSpec;
  onPatch: (p: Partial<TemplateSpec>) => void;
}) {
  const [logos, setLogos] = useState<Logo[]>([]);
  useEffect(() => {
    fetch("/api/logos").then((r) => r.json()).then((j) => setLogos(j.logos ?? [])).catch(() => {});
  }, []);
  // spec.logo 미설정이면 렌더러가 brand 기본 로고로 폴백 — 선택 표시도 같은 기준.
  const effectiveLogoUrl = spec.logo?.url ?? brand.email.headerLogo.url;
  return (
    <div className="rounded-xl border border-border bg-surface p-2.5 space-y-2 text-[12px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-muted">로고</span>
        {logos.map((l) => (
          <button key={l.id} disabled={!spec.showLogo}
            className={`rounded-lg border px-2 py-1 ${!spec.showLogo ? "border-border opacity-40 cursor-not-allowed" : effectiveLogoUrl === l.url ? "border-brand text-brand" : "border-border"}`}
            onClick={() => onPatch({ logo: { url: l.url, width: l.width, alt: l.label } })}>{l.label}</button>
        ))}
        <label className="flex items-center gap-1 ml-auto">
          {/* 끄면 tagline 도 비운다 — 숨긴 로고 밑 문구가 spec 에 남지 않게. */}
          <input type="checkbox" checked={spec.showLogo} onChange={(e) => onPatch(e.target.checked ? { showLogo: true } : { showLogo: false, tagline: "" })} /> 표시
        </label>
      </div>
      <input className={`input text-[13px] py-1.5 ${!spec.showLogo ? "opacity-40 cursor-not-allowed" : ""}`} disabled={!spec.showLogo}
        value={spec.tagline ?? ""} placeholder="로고 아래 한 줄 (선택)" onChange={(e) => onPatch({ tagline: e.target.value })} />
    </div>
  );
}

/** Default header logo for a brand-new block email (same rule as before: the RLWRLD wordmark). */
export async function defaultLogo(): Promise<NonNullable<TemplateSpec["logo"]> | null> {
  try {
    const j = await fetch("/api/logos").then((r) => r.json());
    const list: Logo[] = j.logos ?? [];
    const d = list.find((x) => x.id === "rlwrld") ?? list[0];
    return d ? { url: d.url, width: d.width, alt: d.label } : null;
  } catch {
    return null;
  }
}
