/**
 * 관리자 레지스트리 — env ADMIN_EMAILS(영구 시드) + data/admins.json(런타임 추가).
 * 관리자는 설정 UI에서 관리자를 추가/삭제할 수 있다 (시드·본인은 삭제 불가).
 * 파일 쓰기는 atomic + per-key lock (다른 운영 데이터와 동일 패턴).
 */
import fs from "fs/promises";
import path from "path";
import { atomicWrite, withFileLock, readJsonSafe } from "./atomic";
import { adminEmails } from "./config";
import { brand } from "../brand.config";

const DATA_DIR = path.join(process.cwd(), "data");
const ADMINS_PATH = path.join(DATA_DIR, "admins.json");
const LOCK_KEY = "admins:file";

export type AdminEntry = { email: string; seed: boolean };

async function readFileAdmins(): Promise<string[]> {
  const arr = await readJsonSafe<string[]>(ADMINS_PATH, []);
  return Array.isArray(arr)
    ? arr.map((e) => String(e ?? "").toLowerCase().trim()).filter(Boolean)
    : [];
}

/** 유효 관리자 전체 = env 시드 ∪ 파일. 시드는 삭제 불가 표시. */
export async function listAdmins(): Promise<AdminEntry[]> {
  const seeds = adminEmails();
  const file = await readFileAdmins();
  const out: AdminEntry[] = seeds.map((email) => ({ email, seed: true }));
  for (const email of file) {
    if (!seeds.includes(email)) out.push({ email, seed: false });
  }
  return out;
}

/** env 시드 + 파일 등록분을 모두 보는 관리자 판정. 라우트는 반드시 이걸 사용. */
export async function isAdminAsync(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const e = email.toLowerCase();
  if (adminEmails().includes(e)) return true;
  return (await readFileAdmins()).includes(e);
}

/** 리소스 소유자 또는 관리자인지. 소유자 정보가 없는 레거시 리소스는 누구나 편집 허용. */
export async function canManageAsync(
  ownerEmail: string | undefined | null,
  actorEmail: string | undefined | null,
): Promise<boolean> {
  if (!ownerEmail) return true; // 레거시(소유자 미기록) — 잠그지 않음
  if (!actorEmail) return false;
  if (ownerEmail.toLowerCase() === actorEmail.toLowerCase()) return true;
  return isAdminAsync(actorEmail);
}

const LOGIN_DOMAIN = brand.auth.loginDomain;

/** 관리자 추가 (관리자만 — 라우트에서 강제). 로그인 도메인 계정만 허용. */
export async function addAdmin(email: string): Promise<AdminEntry> {
  const e = String(email ?? "").toLowerCase().trim();
  if (!e) throw new Error("이메일이 비어 있습니다");
  if (!e.endsWith(`@${LOGIN_DOMAIN}`)) throw new Error(`@${LOGIN_DOMAIN} 계정만 관리자로 추가할 수 있습니다`);
  return withFileLock(LOCK_KEY, async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const file = await readFileAdmins();
    if (adminEmails().includes(e) || file.includes(e)) throw new Error("이미 관리자입니다");
    await atomicWrite(ADMINS_PATH, JSON.stringify([...file, e], null, 2));
    return { email: e, seed: false };
  });
}

/** 관리자 삭제 — env 시드와 본인은 삭제 불가(잠금 사고 방지). */
export async function removeAdmin(email: string, actor: string): Promise<{ ok: boolean; reason?: string }> {
  const e = String(email ?? "").toLowerCase().trim();
  if (adminEmails().includes(e)) return { ok: false, reason: "고정 관리자(환경설정)는 삭제할 수 없습니다" };
  if (e === actor.toLowerCase()) return { ok: false, reason: "본인은 삭제할 수 없습니다" };
  return withFileLock(LOCK_KEY, async () => {
    const file = await readFileAdmins();
    const next = file.filter((x) => x !== e);
    if (next.length === file.length) return { ok: false, reason: "관리자를 찾을 수 없습니다" };
    await atomicWrite(ADMINS_PATH, JSON.stringify(next, null, 2));
    return { ok: true };
  });
}
