"use client";

import GuideBody from "./GuideBody";
import { GUIDE_UPDATED_AT } from "@/lib/guide-content";
import { useEscClose } from "./hooks";

/** 사용 가이드 모달 — 최대 960px, 높이 80vh. */
export default function GuideDialog({ onClose }: { onClose: () => void }) {
  useEscClose(true, onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-[960px] h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <div className="kicker">GUIDE</div>
            <h2 className="mt-1 text-base font-semibold">사용 가이드</h2>
          </div>
          <span className="ml-auto text-[11px] text-muted shrink-0">최종 갱신 {GUIDE_UPDATED_AT}</span>
          <a
            href="/guide"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost text-[11px] py-1 shrink-0"
            title="가이드를 보면서 화면을 조작하려면 새 탭으로 여세요"
          >
            새 탭에서 열기 ↗
          </a>
          <button onClick={onClose} className="text-muted hover:text-text shrink-0" aria-label="닫기">
            ✕
          </button>
        </div>

        <GuideBody />
      </div>
    </div>
  );
}
