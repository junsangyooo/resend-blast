/**
 * 운영 설정 단일 진실 소스.
 * - 발신자(From) 화이트리스트: 내장 + data/from.json(운영자 추가)을 senders.ts 가 합친다.
 *   브랜드 발신 도메인(brand.auth.senderDomain) 외는 isFromAllowed 로 차단
 *   (운영자 실수 방지, Resend 도메인 검증과 별개).
 * - 발송 남용 방지 상한·관리자·앱 URL·컴플라이언스 발신자 정보도 여기서 단일 관리.
 * 브랜드 종속 값은 brand.config.ts, 비밀·환경별 값은 환경변수로 받는다.
 */
import { brand } from "../brand.config";

export type FromOption = {
  /** 실제 RFC 5322 from 값 (e.g., "RLDX-1 by RLWRLD <launch@rlwrld.ai>") */
  value: string;
  /** UI 표시명 */
  label: string;
  /** 내장 발신자는 삭제 불가 */
  builtin?: boolean;
  /** "shared" = 공용(관리자 관리, 전원 사용 가능) / "personal" = 개인(본인 주소, 본인만 노출·사용) */
  scope?: "shared" | "personal";
  /** personal 발신자의 소유자 이메일 (lowercase). */
  owner?: string;
};

/** 내장 발신자(항상 존재, 삭제 불가). 운영자 추가분은 data/from.json (lib/senders.ts). */
export const BUILTIN_FROM: FromOption[] = brand.senders.builtinFrom;

export const FROM_DEFAULT = BUILTIN_FROM[0].value;
export const REPLY_TO_DEFAULT = brand.senders.replyToDefault;

/** brand.auth.senderDomain 으로 끝나는 from/reply-to 만 허용하는 정규식. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const ALLOWED_FROM_DOMAIN = new RegExp(`@${escapeRegExp(brand.auth.senderDomain)}>?\\s*$`, "i");

/** @deprecated 조용한 폴백은 발신자 오발송 사고 소지 — 발송 검증은 lib/senders.ts 의
 *  isSenderAllowedFor 를 사용하고, 미등록 from 은 400 으로 거부한다. */
export function resolveFrom(input: string | undefined | null): string {
  const v = String(input ?? "").trim();
  if (!v) return FROM_DEFAULT;
  if (BUILTIN_FROM.some((o) => o.value === v)) return v;
  return FROM_DEFAULT;
}

/** 안전망: 어떤 경로로든 @rlwrld.ai 외 도메인의 from/reply-to 가 사용되지 않도록 강제. */
export function isFromAllowed(value: string): boolean {
  return ALLOWED_FROM_DOMAIN.test(value);
}

/** "Name <a@b.com>" 또는 "a@b.com" 에서 주소부만 추출 (lowercase). 실패 시 "". */
function emailAddr(v: string | undefined | null): string {
  const s = String(v ?? "").trim();
  const m = s.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (m) return m[1].toLowerCase();
  return /^[^<>@\s]+@[^<>@\s]+$/.test(s) ? s.toLowerCase() : "";
}
const REPLY_TO_DEFAULT_ADDR = emailAddr(REPLY_TO_DEFAULT);

/** reply-to 검증: 비어있으면 빈 문자열(=Reply-To 헤더 미부착 → 회신이 From 으로).
 *  허용: (a) senderDomain 도메인 주소, 또는 (b) 설정된 외부 회신주소(brand.senders.replyToDefault).
 *  → 운영자가 의도한 외부(gmail 등) 회신은 막지 않되, 임의 외부 주소 주입은 차단. */
export function resolveReplyTo(input: string | undefined | null): string {
  const v = String(input ?? "").trim();
  if (!v) return "";
  if (isFromAllowed(v)) return v;
  if (REPLY_TO_DEFAULT_ADDR && emailAddr(v) === REPLY_TO_DEFAULT_ADDR) return v;
  return "";
}

// ── 발송 남용 방지 상한 (환경변수로 조정 가능) ──
function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
/** 1회 발송 최대 수신자 수. 초과 시 발송 거부. */
export const MAX_RECIPIENTS_PER_SEND = intEnv("MAX_RECIPIENTS_PER_SEND", 1000);
/** 사용자별 24시간 누적 발송 상한. */
export const USER_DAILY_SEND_LIMIT = intEnv("USER_DAILY_SEND_LIMIT", 5000);
/** 사용자별 1시간 누적 발송 상한. */
export const USER_HOURLY_SEND_LIMIT = intEnv("USER_HOURLY_SEND_LIMIT", 2000);
/** 발송 간 최소 간격(ms). Resend 기본 한도(초당 5건)보다 보수적으로. */
export const SEND_MIN_GAP_MS = intEnv("SEND_MIN_GAP_MS", 220);

// ── 관리자 (남의 리스트·템플릿 편집/삭제, 발신자·관리자 관리 가능) ──
// env ADMIN_EMAILS = 영구 시드(삭제 불가). 런타임 추가분은 data/admins.json (lib/admins.ts).
// 권한 판정은 항상 lib/admins.ts 의 isAdminAsync / canManageAsync 를 사용할 것 —
// 이 sync 버전은 env 시드만 보므로 파일 등록 관리자를 놓친다.
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
/** @deprecated env 시드만 검사. 라우트/라이브러리는 lib/admins.ts 의 isAdminAsync 사용. */
export function isAdmin(email?: string | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

// ── 앱 공개 URL (이메일 내 수신거부 링크 생성용 — 발송 루프엔 요청 컨텍스트가 없어 환경값 사용) ──
export function appBaseUrl(): string {
  return brand.identity.appBaseUrl;
}

// ── 컴플라이언스 푸터: 전송자 정보 (정보통신망법·CAN-SPAM) ──
/** 전송자 명칭 (정보통신망법 제50조 제4항). */
export const SENDER_ORG_NAME = brand.senders.orgName;
/** 발신자 물리 우편주소 (CAN-SPAM 의무). 비어있으면 푸터에서 생략 — 외부 발송 전 반드시 채울 것. */
export const SENDER_POSTAL_ADDRESS = brand.senders.postalAddress;
/** 전송자 연락처 (이메일). */
export const SENDER_CONTACT_EMAIL = brand.senders.contactEmail;
