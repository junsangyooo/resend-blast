"use client";
// 머리말/꼬리말 설정 — 조립기 상단 접이식. 로고 변경·푸터 수정은 여기서 직접 (AI 불필요).
import { useEffect, useState } from "react";
import type { TemplateSpec } from "@/lib/blocks";
import { brand } from "@/brand.config";

type Logo = { id: string; label: string; url: string; width: number };

export default function HeaderFooterBar({ spec, onPatch, onPatchFooter, onDefaultLogo }: {
  spec: TemplateSpec;
  onPatch: (p: Partial<TemplateSpec>) => void;
  onPatchFooter: (p: Partial<NonNullable<TemplateSpec["footer"]>>) => void;
  /** 신규 세션 기본 로고 주입 (dirty 안 만드는 setter — 편집 모드에서는 미전달). */
  onDefaultLogo?: (logo: NonNullable<TemplateSpec["logo"]>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [logos, setLogos] = useState<Logo[]>([]);
  useEffect(() => {
    fetch("/api/logos").then((r) => r.json()).then((j) => {
      const list: Logo[] = j.logos ?? [];
      setLogos(list);
      // 신규 생성 기본값: 브랜드 워드마크 로고(built-in id) — 구 컴포저 defaultLogoSpec 과 동일 규칙.
      const d = list.find((x) => x.id === "primary") ?? list[0];
      if (d && onDefaultLogo) onDefaultLogo({ url: d.url, width: d.width, alt: d.label });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const inp = "input text-[13px] py-1.5";
  // spec.logo 미설정이면 렌더러가 brand 기본 로고로 폴백 — 선택 UI 도 같은 기준으로 하이라이트.
  const effectiveLogoUrl = spec.logo?.url ?? brand.email.headerLogo.url;
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="p-2.5 space-y-1.5">
        <input className={`${inp} font-semibold`} value={spec.subject} placeholder="이메일 제목 *" onChange={(e) => onPatch({ subject: e.target.value })} />
        <div className="flex gap-1.5">
          <input className={`${inp} flex-1`} value={spec.preheader ?? ""} placeholder="프리헤더 (받은편지함 미리보기 문구)" onChange={(e) => onPatch({ preheader: e.target.value })} />
          <button className="btn-ghost text-[11px] whitespace-nowrap" onClick={() => setOpen(!open)}>{open ? "설정 접기 ▴" : "로고·푸터 ▾"}</button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border p-2.5 space-y-2 text-[12px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-muted">헤더 로고</span>
            {logos.map((l) => (
              <button key={l.id} disabled={!spec.showLogo}
                className={`rounded-lg border px-2 py-1 ${!spec.showLogo ? "border-border opacity-40 cursor-not-allowed" : effectiveLogoUrl === l.url ? "border-brand text-brand" : "border-border"}`}
                onClick={() => onPatch({ logo: { url: l.url, width: l.width, alt: l.label } })}>{l.label}</button>
            ))}
            <label className="flex items-center gap-1 ml-auto">
              {/* 끄면 tagline 도 비운다 — 숨긴 로고 밑 문구가 spec 에 남지 않게 (사용자 결정). */}
              <input type="checkbox" checked={spec.showLogo} onChange={(e) => onPatch(e.target.checked ? { showLogo: true } : { showLogo: false, tagline: "" })} /> 로고 표시
            </label>
          </div>
          <input className={`${inp} ${!spec.showLogo ? "opacity-40 cursor-not-allowed" : ""}`} disabled={!spec.showLogo}
            value={spec.tagline ?? ""} placeholder="로고 밑 한 줄 (선택)" onChange={(e) => onPatch({ tagline: e.target.value })} />
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-muted">푸터</span>
            <label className="flex items-center gap-1"><input type="checkbox" checked={spec.showFooter} onChange={(e) => onPatch({ showFooter: e.target.checked })} /> 표시</label>
            {/* 부모(표시) off 시 자식 옵션은 해제 표시 + 비활성 — 값은 보존해 다시 켜면 복귀. */}
            <label className={`flex items-center gap-1 ${!spec.showFooter ? "opacity-40" : ""}`}><input type="checkbox" disabled={!spec.showFooter} checked={spec.showFooter && spec.footer?.showSocial !== false} onChange={(e) => onPatchFooter({ showSocial: e.target.checked })} /> 소셜</label>
            <label className={`flex items-center gap-1 ${!spec.showFooter ? "opacity-40" : ""}`}><input type="checkbox" disabled={!spec.showFooter} checked={spec.showFooter && spec.footer?.showUnsubscribe !== false} onChange={(e) => onPatchFooter({ showUnsubscribe: e.target.checked })} /> 수신거부</label>
          </div>
          <input className={`${inp} ${!spec.showFooter ? "opacity-40 cursor-not-allowed" : ""}`} disabled={!spec.showFooter}
            value={spec.footer?.inquiryEmail ?? ""} placeholder={`문의 이메일 (기본: ${brand.email.defaultInquiry})`} onChange={(e) => onPatchFooter({ inquiryEmail: e.target.value })} />
        </div>
      )}
    </div>
  );
}
