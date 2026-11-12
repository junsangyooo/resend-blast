/**
 * Fixed status / problem wording — the only place these strings live (client + server).
 * Style rule (team decision): short noun phrases, no sentences, never repeat information
 * that is already on screen. Add a new entry here instead of writing ad-hoc text.
 */

/** Why a scheduled send did not (fully) run. Shown in the schedule tab. */
export const PROBLEM = {
  missed: "서버 중단으로 예약 미실행",
  restartAborted: (unsent: number) => `서버 재시작으로 발송 중단 · 미발송 ${unsent}명`,
  runError: "실행 오류로 발송 중단",
  senderUnavailable: "발신자 사용 불가로 미실행",
  snapshotMissing: "예약 내용 누락으로 미실행",
  overLimit: (unsent: number) => `발송 한도 초과 · 미발송 ${unsent}명`,
  failed: (n: number) => `발송 실패 ${n}명`,
} as const;

/** Why one recipient was not sent (recipient.error when status = skipped). */
export const SKIP_REASON = {
  suppressed: "수신거부·반송 주소",
  overLimit: "발송 한도 초과",
  canceled: "예약 취소",
  missed: "서버 중단으로 미실행",
  senderUnavailable: "발신자 사용 불가",
  snapshotMissing: "예약 내용 누락",
} as const;

/** Reasons that mean "deliberately not sent" — never offered for re-send. */
export function isIntentionalSkip(error: string | undefined): boolean {
  return !!error && (/수신거부/.test(error) || /취소/.test(error));
}
/** Reasons that mean "never got the chance" — offered for "미발송자 이어 보내기". */
export function isUnreachedSkip(error: string | undefined): boolean {
  return !!error && !isIntentionalSkip(error);
}

/** Send / schedule state labels. "due" = time passed, runner not yet picked it up. "partial" = completed with gaps. */
export const SEND_STATUS_LABEL: Record<string, string> = {
  scheduled: "예약",
  due: "발송 대기",
  running: "발송 중",
  completed: "완료",
  partial: "일부 발송",
  aborted: "중단",
  canceled: "취소",
  missed: "미실행",
  failed: "실행 실패",
};

/** Per-recipient labels. A "pending" recipient of a finished send is shown as 미발송. */
export const RECIPIENT_STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  sent: "발송",
  failed: "실패",
  skipped: "미발송",
};

/** "Already received" kinds — shown as a re-send sign on recipients. */
export const PRIOR_LABEL = {
  same: "재발송",
  modified: "재발송 · 수정본",
  scheduled: "중복 예약",
} as const;
