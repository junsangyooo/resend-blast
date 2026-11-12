/**
 * Sender (From) registry: built-in plus operator-added entries (data/from.json).
 *
 * Model:
 *  - builtin: shared senders from brand.config (cannot be deleted)
 *  - shared : shared senders added by an admin (usable by everyone)
 *  - personal: a personal sender with a nickname on the user's own address (@domain), visible and usable only by that user
 *  - Every other user can still send from the virtual "내 계정" option (their own address) without anything being stored
 *
 * Legacy from.json (no scope recorded) is migrated to personal on read;
 * owner is inferred from the address part of value (e.g. "Jane Doe <jane.doe@example.com>").
 * File writes use atomic + per-key lock (same pattern as the other operational data).
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

/** Extract only the address part from "Name <a@b.com>" or "a@b.com" (lowercase). Null on failure. */
export function addressOf(value: string): string | null {
  const v = String(value ?? "").trim();
  const m = v.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (m) return m[1].toLowerCase();
  if (/^[^<>@\s]+@[^<>@\s]+$/.test(v)) return v.toLowerCase();
  return null;
}

/** Email local part → auto-generated display name: "junsang.yoo" → "Junsang Yoo". */
export function displayNameFromEmail(email: string): string {
  const local = String(email ?? "").split("@")[0] ?? "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || email;
}

/** The virtual "내 계정" sender option, synthesized without storage. */
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
  // Legacy entry (no scope recorded) → personal; owner is inferred from the address part.
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
 * Sender list: built-in + all shared + the viewer's own personal ones.
 * Without viewerEmail, only built-in + shared. Deduped by value (built-in wins).
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

/** For admins: every custom sender including personal (owner exposed). Avoids a settings-UI blind spot (legacy personal). */
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
 * Validate from at send time: allowed if built-in/shared, or if the address part is the user's own email.
 * (The user's own address is allowed with any display name, covering both the "내 계정" virtual option and personal nicknames.
 *  Someone else's personal sender has a different address part, so it is blocked automatically.)
 */
export async function isSenderAllowedFor(value: string, senderEmail: string): Promise<boolean> {
  const v = String(value ?? "").trim();
  if (!v) return false;
  if (BUILTIN_FROM.some((o) => o.value === v)) return true;
  const custom = await readCustom();
  if (custom.some((o) => o.scope === "shared" && o.value === v)) return true;
  return addressOf(v) === senderEmail.toLowerCase();
}

/**
 * Add a sender. shared is admin-only (enforced in the route); personal allows only the user's own address.
 * One personal sender per user: an existing personal entry of theirs is replaced (nickname change).
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
  // Validate the display name: block special characters that break RFC 5322 or pollute headers.
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
      ? custom.filter((o) => !(o.scope === "personal" && o.owner === owner)) // replace the user's own nickname
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
 * Delete a custom sender. Built-in ones are protected.
 * shared is admin-only (enforced in the route); personal can be deleted by its owner or an admin.
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
