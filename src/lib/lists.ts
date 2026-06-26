/**
 * Recipient lists — first-class objects.
 * Storage: data/lists/{slug}.json (atomic write, lock per single file)
 * Permissions: anyone can view/edit; only the creator (createdBy) can delete.
 */
import fs from "fs/promises";
import path from "path";
import { atomicWrite, withFileLock, readJsonSafe } from "./atomic";
import { dedupeRecipients, type Recipient } from "./recipients";
import { canManageAsync } from "./admins";

const LISTS_DIR = path.join(process.cwd(), "data", "lists");

export type List = {
  slug: string;
  name: string;
  description: string;
  members: Recipient[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
};

export type ListSummary = Omit<List, "members"> & { memberCount: number };

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;

export function slugify(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/**
 * Derive a base slug from the name (or an explicit slug).
 * When slugify yields an empty result (e.g. pure Korean), generate a fallback (`list-<seed>`) —
 * the slug is only an internal filename/key while the name is what's shown, so an arbitrary slug is fine.
 */
export function deriveBaseSlug(name: string, slug?: string, fallbackSeed?: string): string {
  const base = slug ? slugify(slug) : slugify(name);
  if (base) return base;
  return `list-${fallbackSeed ?? Date.now().toString(36)}`;
}

function pathFor(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error("잘못된 리스트 슬러그");
  return path.join(LISTS_DIR, `${slug}.json`);
}

async function ensureDir() {
  await fs.mkdir(LISTS_DIR, { recursive: true });
}

export async function listAll(): Promise<ListSummary[]> {
  await ensureDir();
  const files = await fs.readdir(LISTS_DIR);
  const out: ListSummary[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const slug = f.replace(/\.json$/, "");
    if (!SLUG_RE.test(slug)) continue;
    const data = await readJsonSafe<List | null>(path.join(LISTS_DIR, f), null);
    if (!data) continue;
    out.push({
      slug: data.slug,
      name: data.name,
      description: data.description ?? "",
      createdBy: data.createdBy,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      memberCount: data.members?.length ?? 0,
    });
  }
  return out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function getList(slug: string): Promise<List | null> {
  if (!SLUG_RE.test(slug)) return null;
  return readJsonSafe<List | null>(pathFor(slug), null);
}

export async function createList(input: {
  name: string;
  description?: string;
  createdBy: string;
  members?: Recipient[];
  slug?: string;
}): Promise<List> {
  const baseSlug = deriveBaseSlug(input.name, input.slug);
  return withFileLock(`lists:${baseSlug}`, async () => {
    await ensureDir();
    const files = await fs.readdir(LISTS_DIR);
    const used = new Set(files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")));
    let slug = baseSlug;
    let i = 2;
    while (used.has(slug)) slug = `${baseSlug}-${i++}`;
    if (!SLUG_RE.test(slug)) throw new Error("슬러그 생성 실패");
    const now = new Date().toISOString();
    const data: List = {
      slug,
      name: input.name.trim() || slug,
      description: input.description?.trim() ?? "",
      members: dedupeRecipients(input.members ?? []),
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    await atomicWrite(pathFor(slug), JSON.stringify(data, null, 2));
    return data;
  });
}

export async function updateList(
  slug: string,
  patch: Partial<Pick<List, "name" | "description" | "members">>,
  actorEmail?: string
): Promise<List> {
  return withFileLock(`lists:${slug}`, async () => {
    const cur = await getList(slug);
    if (!cur) throw new Error("리스트를 찾을 수 없습니다");
    if (!(await canManageAsync(cur.createdBy, actorEmail))) {
      throw new Error("이 리스트를 수정할 권한이 없습니다 (생성자 또는 관리자만 가능).");
    }
    const next: List = {
      ...cur,
      ...(patch.name !== undefined ? { name: patch.name.trim() || cur.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.members !== undefined ? { members: dedupeRecipients(patch.members) } : {}),
      updatedAt: new Date().toISOString(),
      updatedBy: actorEmail ?? cur.updatedBy,
    };
    await atomicWrite(pathFor(slug), JSON.stringify(next, null, 2));
    return next;
  });
}

export async function importMembers(
  slug: string,
  members: Recipient[],
  mode: "merge" | "replace",
  actorEmail?: string
): Promise<List> {
  return withFileLock(`lists:${slug}`, async () => {
    const cur = await getList(slug);
    if (!cur) throw new Error("리스트를 찾을 수 없습니다");
    if (!(await canManageAsync(cur.createdBy, actorEmail))) {
      throw new Error("이 리스트를 수정할 권한이 없습니다 (생성자 또는 관리자만 가능).");
    }
    const combined = mode === "replace" ? members : [...cur.members, ...members];
    const next: List = {
      ...cur,
      members: dedupeRecipients(combined),
      updatedAt: new Date().toISOString(),
      updatedBy: actorEmail ?? cur.updatedBy,
    };
    await atomicWrite(pathFor(slug), JSON.stringify(next, null, 2));
    return next;
  });
}

export async function deleteList(slug: string, requesterEmail: string): Promise<void> {
  return withFileLock(`lists:${slug}`, async () => {
    const cur = await getList(slug);
    if (!cur) return;
    if (!(await canManageAsync(cur.createdBy, requesterEmail))) {
      throw new Error("생성자 또는 관리자만 리스트를 삭제할 수 있습니다");
    }
    await fs.unlink(pathFor(slug));
  });
}

/** Merge members from multiple lists and dedupe (used at send time). */
export async function resolveListMembers(slugs: string[]): Promise<Recipient[]> {
  const all: Recipient[] = [];
  for (const s of slugs) {
    const l = await getList(s);
    if (l) all.push(...l.members);
  }
  return dedupeRecipients(all);
}

/**
 * Merge members from multiple lists, returning each member's **first matching list slug**.
 * Even if a person belongs to both A and B, they're labeled with the first matched list
 * (for origin display in the tracking sidebar). Dedupe is performed as well.
 */
export async function resolveListMembersWithOrigin(
  slugs: string[]
): Promise<{ email: string; name?: string; listSlug: string }[]> {
  const out: { email: string; name?: string; listSlug: string }[] = [];
  const seen = new Set<string>();
  for (const s of slugs) {
    const l = await getList(s);
    if (!l) continue;
    for (const m of l.members) {
      const e = (m.email ?? "").toLowerCase().trim();
      if (!e || seen.has(e)) continue;
      seen.add(e);
      out.push({ email: e, name: m.name, listSlug: s });
    }
  }
  return out;
}
