"use client";

import RecipientInput from "./RecipientInput";
import { useEscClose } from "./hooks";

/**
 * Ad-hoc recipient popup — moves the free-text/CSV input (RecipientInput) into a popup
 * so step 2 of the send screen stays compact. Text is the single source: the parent
 * (SendForm) holds it and does the parsing too.
 */
export default function AdhocDialog({
  open, value, count, onTextChange, onClose,
}: {
  open: boolean;
  value: string;
  count: number;
  onTextChange: (text: string) => void;
  onClose: () => void;
}) {
  useEscClose(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[86vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <div className="kicker">Ad-hoc</div>
            <h2 className="mt-0.5 text-base font-semibold">수신자 직접 입력</h2>
          </div>
          <button onClick={onClose} className="icon-btn" title="닫기">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <RecipientInput
            label="직접 입력 (이름 + 이메일)"
            value={value}
            onTextChange={onTextChange}
          />
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0">
          <span className="text-[11px] text-muted">
            리스트와 합쳐 이메일 기준 중복 제거 후 발송됩니다.
          </span>
          <button onClick={onClose} className="btn-primary text-sm">
            완료{count > 0 ? ` (${count}명)` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
