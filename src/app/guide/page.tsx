import Link from "next/link";
import GuideBody from "@/components/GuideBody";
import { GUIDE_UPDATED_AT } from "@/lib/guide-content";
import { brand } from "@/brand.config";

export const metadata = { title: `사용 가이드 · ${brand.identity.appName}` };

/** Full guide page — same content as the modal. For following along with screens side by side. */
export default function GuidePage() {
  return (
    <div className="h-dvh flex flex-col bg-bg">
      <header className="h-14 shrink-0 bg-surface border-b border-border flex items-center gap-3 pl-6 pr-4">
        <span className="font-extrabold tracking-tight text-brand text-[15px]">{brand.ui.headerBrand}</span>
        <span className="w-px h-4 bg-border shrink-0" aria-hidden />
        <span className="text-muted text-sm font-medium">사용 가이드</span>
        <span className="ml-auto text-[11px] text-muted">최종 갱신 {GUIDE_UPDATED_AT}</span>
        <Link href="/" className="btn-ghost text-[12px] py-1.5">← 발송 화면</Link>
      </header>

      <main className="flex-1 min-h-0 flex flex-col">
        <GuideBody />
      </main>
    </div>
  );
}
