"use client";

import { useEscClose } from "./hooks";

/**
 * New-email entry popup — block composer / upload (HTML). Same two entry points
 * the old left rail's "이메일" menu had, moved onto step 1 of the send screen.
 */
export default function CreateEmailDialog({
  open, onClose, onCreate, onUpload,
}: {
  open: boolean;
  onClose: () => void;
  /** Open the block composer (TemplateComposer). */
  onCreate: () => void;
  /** Open raw HTML input (AddTemplateDialog). */
  onUpload: () => void;
}) {
  useEscClose(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="kicker">New Email</div>
            <h2 className="mt-0.5 text-base font-semibold">새 이메일 만들기</h2>
          </div>
          <button onClick={onClose} className="icon-btn" title="닫기">✕</button>
        </div>

        <div className="p-4 space-y-2">
          <button
            onClick={onCreate}
            className="w-full text-left rounded-xl border border-border hover:border-brand/50 hover:bg-brand/5 transition p-4 flex items-start gap-3"
          >
            <span className="text-brand mt-0.5 shrink-0"><LayoutIcon /></span>
            <span>
              <span className="block text-sm font-semibold text-text">블록으로 만들기</span>
              <span className="block text-[11px] text-muted mt-0.5">블록을 쌓아 온브랜드 메일 제작</span>
            </span>
          </button>
          <button
            onClick={onUpload}
            className="w-full text-left rounded-xl border border-border hover:border-brand/50 hover:bg-brand/5 transition p-4 flex items-start gap-3"
          >
            <span className="text-brand mt-0.5 shrink-0"><CodeIcon /></span>
            <span>
              <span className="block text-sm font-semibold text-text">업로드</span>
              <span className="block text-[11px] text-muted mt-0.5">HTML 파일·코드 업로드</span>
            </span>
          </button>
        </div>
      </div>
    </div>
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

function CodeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
    </svg>
  );
}
