"use client";

import RecipientInput from "./RecipientInput";
import { useEscClose } from "./hooks";

/**
 * 직접 입력(ad-hoc) 팝업 — 발송 화면 2단계를 컴팩트하게 유지하기 위해
 * 자유텍스트/CSV 입력(RecipientInput)을 팝업으로 분리.
 * 텍스트가 단일 소스: 부모(SendForm)가 보관하고 파싱도 부모가 수행한다.
 */
export default function AdhocDialog({
  open, value, count, onTextChange, onSaveAsList, onClose,
}: {
  open: boolean;
  value: string;
  count: number;
  onTextChange: (text: string) => void;
  /** Save the parsed recipients as a reusable list. */
  onSaveAsList?: () => void;
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
          <span className="text-[12px] text-muted">
            리스트와 합쳐 이메일 기준 중복 제거 후 발송됩니다.
          </span>
          <span className="flex items-center gap-2 shrink-0">
            {onSaveAsList && count > 0 && (
              <button onClick={onSaveAsList} className="btn-ghost text-sm" title="다음에도 쓰도록 리스트로 저장">리스트로 저장</button>
            )}
            <button onClick={onClose} className="btn-primary text-sm">
              완료{count > 0 ? ` (${count}명)` : ""}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
