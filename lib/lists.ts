/**
 * 수신자 리스트 — 1급 객체.
 * 저장: data/lists/{slug}.json (atomic write, 단일 파일 단위 락)
 * 권한: 모두 조회/수정 가능, 삭제는 생성자(createdBy)만.
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
 * 이름(또는 명시적 slug)에서 베이스 슬러그 도출.
 * 순수 한글 등으로 slugify 결과가 비면 fallback(`list-<seed>`)을 생성한다 —
 * 슬러그는 내부 파일명/키일 뿐이고 화면엔 name 이 표시되므로 임의 슬러그로 충분하다.
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

/** 여러 리스트의 멤버를 합쳐서 dedupe (발송 시 사용). */
export async function resolveListMembers(slugs: string[]): Promise<Recipient[]> {
  const all: Recipient[] = [];
  for (const s of slugs) {
    const l = await getList(s);
    if (l) all.push(...l.members);
  }
  return dedupeRecipients(all);
}

/**
 * 여러 리스트의 멤버를 합치면서 각 멤버의 **첫 매칭 리스트 슬러그**를 함께 반환.
 * 한 사람이 A·B 양쪽 멤버여도 처음 매칭된 리스트로 라벨링 (트래킹 사이드바의 출처 표시용).
 * dedupe 도 함께 수행.
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
