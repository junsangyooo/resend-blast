"use client";

import { useEscClose } from "./hooks";

export type SenderOption = { value: string; label: string; builtin?: boolean; scope?: "shared" | "personal" };

/**
 * 공용 발신자 선택 팝업. 내장 + 관리자가 등록한 shared 발신자만 노출된다
 * (개인 발신은 발송 화면의 "내 계정으로" 버튼이 담당).
 */
export default function SenderDialog({
  open, options, current, onSelect, onClose,
}: {
  open: boolean;
  options: SenderOption[];
  current: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  useEscClose(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <div className="kicker">From</div>
            <h2 className="mt-0.5 text-base font-semibold">공용 발신자 선택</h2>
          </div>
          <button onClick={onClose} className="icon-btn" title="닫기">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {options.map((o) => {
            const active = o.value === current;
            return (
              <button
                key={o.value}
                onClick={() => { onSelect(o.value); onClose(); }}
                className={`w-full text-left rounded-xl border px-3.5 py-2.5 transition flex items-center gap-3 ${
                  active ? "border-brand bg-brand/5 ring-1 ring-brand/30" : "border-border hover:border-brand/40"
                }`}
              >
                <span
                  className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${
                    active ? "border-brand bg-brand" : "border-border"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="block text-[13px] font-medium text-text/90 truncate">{o.label}</span>
                    {o.builtin && <span className="chip shrink-0 text-muted">내장</span>}
                  </span>
                  <span className="block font-mono text-[11px] text-muted truncate">{o.value}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-2.5 border-t border-border shrink-0">
          <p className="text-[10px] text-muted">공용 발신자 추가·삭제는 프로필 메뉴 → 설정 → 발신자 관리(관리자)에서.</p>
        </div>
      </div>
    </div>
  );
}
