/**
 * Admin registry — env ADMIN_EMAILS (permanent seed) + data/admins.json (added at runtime).
 * Admins can add/remove admins from the settings UI (seeds and oneself cannot be deleted).
 * File writes use atomic + per-key lock (same pattern as other operational data).
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

/** All effective admins = env seed ∪ file. Seeds marked as non-deletable. */
export async function listAdmins(): Promise<AdminEntry[]> {
  const seeds = adminEmails();
  const file = await readFileAdmins();
  const out: AdminEntry[] = seeds.map((email) => ({ email, seed: true }));
  for (const email of file) {
    if (!seeds.includes(email)) out.push({ email, seed: false });
  }
  return out;
}

/** Admin check that sees both env seeds and file-registered entries. Routes must use this. */
export async function isAdminAsync(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const e = email.toLowerCase();
  // password mode: the single operator (brand.auth.operatorEmail) is always an admin.
  if (brand.auth.mode === "password" && e === brand.auth.operatorEmail.toLowerCase()) return true;
  if (adminEmails().includes(e)) return true;
  return (await readFileAdmins()).includes(e);
}

/** Whether the actor is the resource owner or an admin. Legacy resources without owner info are editable by anyone. */
export async function canManageAsync(
  ownerEmail: string | undefined | null,
  actorEmail: string | undefined | null,
): Promise<boolean> {
  if (!ownerEmail) return true; // legacy (no owner recorded) — not locked
  if (!actorEmail) return false;
  if (ownerEmail.toLowerCase() === actorEmail.toLowerCase()) return true;
  return isAdminAsync(actorEmail);
}

const LOGIN_DOMAIN = brand.auth.loginDomain;

/** Add an admin (admin-only — enforced in the route). Only login-domain accounts allowed. */
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

/** Remove an admin — env seeds and oneself cannot be deleted (prevents lockout accidents). */
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
