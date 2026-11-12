"use client";
// Footer settings — at the very bottom of the builder (same order as the footer position in the preview). Edit directly here without AI.
import type { TemplateSpec } from "@/lib/blocks";
import { brand } from "@/brand.config";

export default function FooterBar({ spec, onPatch, onPatchFooter }: {
  spec: TemplateSpec;
  onPatch: (p: Partial<TemplateSpec>) => void;
  onPatchFooter: (p: Partial<NonNullable<TemplateSpec["footer"]>>) => void;
}) {
  const on = spec.showFooter;
  const dim = on ? "" : "opacity-40";
  // When the parent (display) is off, child options show as unchecked + disabled — values are kept and restored when turned back on.
  const check = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className={`flex items-center gap-1 ${dim}`}>
      <input type="checkbox" disabled={!on} checked={on && checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
  return (
    <div className="rounded-xl border border-border bg-surface p-2.5 space-y-2 text-[12px]">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-muted">푸터</span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={on} onChange={(e) => onPatch({ showFooter: e.target.checked })} /> 표시</label>
        {check("소셜", spec.footer?.showSocial !== false, (v) => onPatchFooter({ showSocial: v }))}
        {check("회사명", spec.footer?.showOrgName !== false, (v) => onPatchFooter({ showOrgName: v }))}
        {check("문의", spec.footer?.showInquiry !== false, (v) => onPatchFooter({ showInquiry: v }))}
        {check("수신거부", spec.footer?.showUnsubscribe !== false, (v) => onPatchFooter({ showUnsubscribe: v }))}
      </div>
      {on && spec.footer?.showInquiry !== false && (
        <input className="input text-[13px] py-1.5" value={spec.footer?.inquiryEmail ?? ""}
          placeholder={`문의 이메일 (기본: ${brand.email.defaultInquiry})`}
          onChange={(e) => onPatchFooter({ inquiryEmail: e.target.value })} />
      )}
    </div>
  );
}
