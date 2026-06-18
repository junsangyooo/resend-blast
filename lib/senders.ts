/**
 * 발신자(From) 레지스트리 — 내장 + 운영자 추가분(data/from.json).
 *
 * 모델:
 *  - builtin: brand.config 의 공용 발신자 (삭제 불가)
 *  - shared : 관리자가 추가한 공용 발신자 (전원 사용 가능)
 *  - personal: 본인 주소(@도메인)에 닉네임을 붙인 개인 발신자 — 본인에게만 노출·사용 가능
 *  - 그 외에 모든 사용자는 저장 없이 "내 계정" 가상 옵션(본인 주소)으로 발송 가능
 *
 * 구버전 from.json(스코프 미기록)은 읽기 시 personal 로 마이그레이션 —
 * owner 는 value 의 주소부에서 추론한다 (예: "Jacey Cho <jacey.cho@rlwrld.ai>").
 * 파일 쓰기는 atomic + per-key lock (다른 운영 데이터와 동일 패턴).
 */
import fs from "fs/promises";
import path from "path";
import { atomicWrite, withFileLock, readJsonSafe } from "./atomic";
import { BUILTIN_FROM, isFromAllowed, type FromOption } from "./config";
import { brand } from "../brand.config";

const SENDER_DOMAIN = brand.auth.senderDomain;
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const D = escapeRegExp(SENDER_DOMAIN);
const ANGLE_FORM = new RegExp(`<[^>]+@${D}>\\s*$`, "i");
const BARE_FORM = new RegExp(`^[^<>@\\s]+@${D}$`, "i");

const DATA_DIR = path.join(process.cwd(), "data");
const FROM_PATH = path.join(DATA_DIR, "from.json");
const LOCK_KEY = "senders:from";

/** "Name <a@b.com>" 또는 "a@b.com" 에서 주소부만 추출 (lowercase). 실패 시 null. */
export function addressOf(value: string): string | null {
  const v = String(value ?? "").trim();
  const m = v.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (m) return m[1].toLowerCase();
  if (/^[^<>@\s]+@[^<>@\s]+$/.test(v)) return v.toLowerCase();
  return null;
}

/** 이메일 로컬파트 → 표시 이름 자동 생성: "junsang.yoo" → "Junsang Yoo". */
export function displayNameFromEmail(email: string): string {
  const local = String(email ?? "").split("@")[0] ?? "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || email;
}

/** 저장 없이 합성되는 "내 계정" 가상 발신 옵션. */
export function myAccountOption(me: string): FromOption {
  const e = me.toLowerCase();
  return {
    value: `${displayNameFromEmail(e)} <${e}>`,
    label: `내 계정 (${e})`,
    builtin: false,
    scope: "personal",
    owner: e,
  };
}

function normalize(o: FromOption): FromOption {
  // 구버전(스코프 미기록) → personal, owner 는 주소부에서 추론.
  const scope = o.scope === "shared" || o.scope === "personal" ? o.scope : "personal";
  const owner = (o.owner ?? addressOf(o.value) ?? "").toLowerCase() || undefined;
  return { value: o.value, label: o.label || o.value, builtin: false, scope, owner };
}

async function readCustom(): Promise<FromOption[]> {
  const arr = await readJsonSafe<FromOption[]>(FROM_PATH, []);
  return Array.isArray(arr)
    ? arr.filter((o) => o && typeof o.value === "string").map(normalize)
    : [];
}

/**
 * 발신자 목록 — 내장 + 공용(shared) 전체 + 본인 소유 personal.
 * viewerEmail 미지정 시 내장+공용만. value 기준 중복 제거(내장 우선).
 */
export async function listSenders(viewerEmail?: string | null): Promise<FromOption[]> {
  const viewer = viewerEmail?.toLowerCase() ?? null;
  const custom = await readCustom();
  const seen = new Set(BUILTIN_FROM.map((o) => o.value));
  const merged: FromOption[] = BUILTIN_FROM.map((o) => ({ ...o, scope: "shared" as const }));
  for (const o of custom) {
    if (seen.has(o.value)) continue;
    if (o.scope === "personal" && o.owner !== viewer) continue;
    seen.add(o.value);
    merged.push(o);
  }
  return merged;
}

/** 관리자용: personal 포함 모든 커스텀 발신자 (owner 노출). 설정 UI 사각지대(레거시 personal) 방지. */
export async function listSendersAll(): Promise<FromOption[]> {
  const custom = await readCustom();
  const seen = new Set(BUILTIN_FROM.map((o) => o.value));
  const merged: FromOption[] = BUILTIN_FROM.map((o) => ({ ...o, scope: "shared" as const }));
  for (const o of custom) {
    if (!seen.has(o.value)) { seen.add(o.value); merged.push(o); }
  }
  return merged;
}

/**
 * 발송 시 from 검증: 내장/공용이거나, 주소부가 본인 이메일이면 허용.
 * (본인 주소는 어떤 표시 이름이든 허용 — "내 계정" 가상 옵션·개인 닉네임 모두 커버.
 *  남의 personal 발신자는 주소부가 다르므로 자동 차단된다.)
 */
export async function isSenderAllowedFor(value: string, senderEmail: string): Promise<boolean> {
  const v = String(value ?? "").trim();
  if (!v) return false;
  if (BUILTIN_FROM.some((o) => o.value === v)) return true;
  const custom = await readCustom();
  if (custom.some((o) => o.scope === "shared" && o.value === v)) return true;
  return addressOf(v) === senderEmail.toLowerCase();
}

/** @deprecated 소유자 무관 등록 여부만 확인. 발송 검증은 isSenderAllowedFor 사용. */
export async function isKnownSender(value: string): Promise<boolean> {
  const custom = await readCustom();
  return BUILTIN_FROM.some((o) => o.value === value) || custom.some((o) => o.value === value);
}

/**
 * 발신자 추가. shared 는 관리자만(라우트에서 강제), personal 은 본인 주소만 허용.
 * personal 은 1인 1개 — 기존 본인 personal 항목이 있으면 교체(닉네임 변경).
 */
export async function addSender(
  value: string,
  label: string,
  opts: { scope: "shared" | "personal"; owner?: string },
): Promise<FromOption> {
  const v = value.trim();
  if (!v) throw new Error("발신자 값이 비어 있습니다");
  if (!isFromAllowed(v)) throw new Error(`@${SENDER_DOMAIN} 도메인의 발신자만 추가할 수 있습니다`);
  if (!ANGLE_FORM.test(v) && !BARE_FORM.test(v)) {
    throw new Error(`형식: "이름 <addr@${SENDER_DOMAIN}>" 또는 "addr@${SENDER_DOMAIN}"`);
  }
  // 표시 이름 검증: RFC 5322 를 깨거나 헤더를 오염시키는 특수문자 차단.
  const displayPart = v.match(/^(.*?)\s*</)?.[1]?.trim() ?? "";
  if (/[<>"\\,;:\r\n]/.test(displayPart)) {
    throw new Error('표시 이름에는 < > " , ; : 줄바꿈 문자를 쓸 수 없습니다');
  }
  if (displayPart.length > 60) throw new Error("표시 이름이 너무 깁니다 (최대 60자)");
  const owner = opts.owner?.toLowerCase();
  if (opts.scope === "personal") {
    if (!owner) throw new Error("개인 발신자에는 소유자가 필요합니다");
    if (addressOf(v) !== owner) throw new Error("개인 발신자는 본인 이메일 주소만 사용할 수 있습니다");
  }
  return withFileLock(LOCK_KEY, async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const custom = await readCustom();
    const next = opts.scope === "personal"
      ? custom.filter((o) => !(o.scope === "personal" && o.owner === owner)) // 본인 닉네임 교체
      : custom;
    if (BUILTIN_FROM.some((o) => o.value === v) || next.some((o) => o.value === v)) {
      throw new Error("이미 등록된 발신자입니다");
    }
    const opt: FromOption = {
      value: v,
      label: label.trim() || v,
      builtin: false,
      scope: opts.scope,
      ...(opts.scope === "personal" ? { owner } : {}),
    };
    await atomicWrite(FROM_PATH, JSON.stringify([...next, opt], null, 2));
    return opt;
  });
}

/**
 * 커스텀 발신자 삭제. 내장은 보호.
 * shared 는 관리자만(라우트에서 강제), personal 은 소유자 본인 또는 관리자.
 */
export async function removeSender(
  value: string,
  requester: string,
  requesterIsAdmin: boolean,
): Promise<{ ok: boolean; reason?: string }> {
  if (BUILTIN_FROM.some((o) => o.value === value)) {
    return { ok: false, reason: "내장 발신자는 삭제할 수 없습니다" };
  }
  return withFileLock(LOCK_KEY, async () => {
    const custom = await readCustom();
    const target = custom.find((o) => o.value === value);
    if (!target) return { ok: false, reason: "발신자를 찾을 수 없습니다" };
    if (target.scope === "shared" && !requesterIsAdmin) {
      return { ok: false, reason: "공용 발신자는 관리자만 삭제할 수 있습니다" };
    }
    if (target.scope === "personal" && target.owner !== requester.toLowerCase() && !requesterIsAdmin) {
      return { ok: false, reason: "본인 또는 관리자만 삭제할 수 있습니다" };
    }
    const next = custom.filter((o) => o.value !== value);
    await atomicWrite(FROM_PATH, JSON.stringify(next, null, 2));
    return { ok: true };
  });
}
