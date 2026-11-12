"use client";

import { useEscClose } from "./hooks";

/**
 * Create-new-email choice popup — generate (AI Studio) / upload (HTML).
 * The same two entry points as the old left rail's "이메일" menu, moved into step 1 of the send screen.
 */
export default function CreateEmailDialog({
  open, onClose, onUpload,
}: {
  open: boolean;
  onClose: () => void;
  /** Open direct HTML input (AddTemplateDialog). */
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
            onClick={() => { window.location.href = "/studio"; }}
            className="w-full text-left rounded-xl border border-border hover:border-brand/50 hover:bg-brand/5 transition p-4 flex items-start gap-3"
          >
            <span className="text-brand mt-0.5 shrink-0"><SparkIcon /></span>
            <span>
              <span className="block text-sm font-semibold text-text">생성</span>
              <span className="block text-[11px] text-muted mt-0.5">AI 와 대화로 만들고 그 자리에서 수정</span>
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

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
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
