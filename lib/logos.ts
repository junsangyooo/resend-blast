/**
 * Header logo registry.
 * Built-in logos (RLWRLD / RLDX-1) are hardcoded — always present.
 * Uploaded custom logos accumulate in data/logos.json (gitignored, server-persisted).
 * The image files themselves go to the configured storage backend (lib/storage, default Azure Blob).
 */
import fs from "fs/promises";
import path from "path";
import { atomicWrite, withFileLock, readJsonSafe } from "./atomic";
import { brand } from "../brand.config";

export type Logo = { id: string; label: string; url: string; width: number };

const LOCK_KEY = "logos";

export const BUILTIN_LOGOS: Logo[] = brand.logos;

/** Default header logo when spec.logo is unset (keeps existing behavior). */
export const DEFAULT_LOGO = BUILTIN_LOGOS[0];

const DATA_DIR = path.join(process.cwd(), "data");
const LOGOS_PATH = path.join(DATA_DIR, "logos.json");

async function readCustom(): Promise<Logo[]> {
  const arr = await readJsonSafe<Logo[]>(LOGOS_PATH, []);
  return Array.isArray(arr) ? arr : [];
}

async function writeCustom(logos: Logo[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await atomicWrite(LOGOS_PATH, JSON.stringify(logos, null, 2));
}

export async function listLogos(): Promise<Logo[]> {
  return [...BUILTIN_LOGOS, ...(await readCustom())];
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "logo";
}

/** Delete a custom logo. Built-in logos are protected. Don't delete the blob itself (it may be referenced by other sends). */
export async function removeLogo(id: string): Promise<{ ok: boolean; reason?: string }> {
  if (BUILTIN_LOGOS.some((l) => l.id === id)) {
    return { ok: false, reason: "내장 로고는 삭제할 수 없습니다" };
  }
  return withFileLock(LOCK_KEY, async () => {
    const custom = await readCustom();
    const next = custom.filter((l) => l.id !== id);
    if (next.length === custom.length) return { ok: false, reason: "로고를 찾을 수 없습니다" };
    await writeCustom(next);
    return { ok: true };
  });
}

export async function addLogo(label: string, url: string, width = 130): Promise<Logo> {
  const lbl = label.trim() || "Logo";
  return withFileLock(LOCK_KEY, async () => {
    const custom = await readCustom();
    const used = new Set([...BUILTIN_LOGOS, ...custom].map((l) => l.id));
    const base = slugify(lbl);
    let id = base;
    let i = 2;
    while (used.has(id)) id = `${base}-${i++}`;
    const logo: Logo = { id, label: lbl, url, width };
    await writeCustom([...custom, logo]);
    return logo;
  });
}
