import fs from "fs/promises";
import path from "path";
import { renderTemplate, migrateSpec, type TemplateSpec } from "./blocks";
import { atomicWrite, withFileLock } from "./atomic";
import { canManageAsync, isAdminAsync } from "./admins";
import { brand } from "../brand.config";

const TEMPLATES_DIR = path.join(process.cwd(), "templates");
const META_PATH = path.join(TEMPLATES_DIR, "_meta.json");
const META_LOCK_KEY = "templates:meta";

const DEFAULT_SUBJECT = brand.templates.defaultSubject;
const DEFAULT_DESCRIPTION = "";

const FONT_FAMILY = "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

export type TemplateMeta = {
  /** Internal id (file name). Not shown to users. */
  name: string;
  /** What users see: explicit title, else the legacy name, else the subject. */
  title: string;
  subject: string;
  description: string;
  size: number;
  composed: boolean; // whether it was built with the block composer and has a spec (json)
  createdBy?: string;
  lastModifiedBy?: string;
  lastModifiedAt?: string;
};

// A leftover `archived` flag from the old archive feature may still exist in _meta.json,
// but it's ignored now (all emails are always shown in the list).
type MetaEntry = {
  /** User-facing display name (free text, editable). */
  title?: string;
  subject?: string;
  description?: string;
  createdBy?: string;
  lastModifiedBy?: string;
  lastModifiedAt?: string;
};
type MetaFile = Record<string, MetaEntry>;

const NAME_RE = /^[A-Za-z0-9_-]+$/;
const AUTO_ID_RE = /^e-\d{8}-[a-z0-9]{4}$/;

/** New internal id, e.g. "e-20261111-k3x9". Users never type or see it. */
export function newTemplateId(now: Date = new Date()): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  const r = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `e-${d}-${r}`;
}

/** Display title rule (pure): explicit title → legacy hand-typed name → subject. */
export function displayTitle(name: string, m: { title?: string; subject?: string }): string {
  const t = m.title?.trim();
  if (t) return t;
  if (!AUTO_ID_RE.test(name)) return name;
  return m.subject?.trim() || name;
}

async function readMeta(): Promise<MetaFile> {
  try {
    return JSON.parse(await fs.readFile(META_PATH, "utf-8"));
  } catch {
    return {};
  }
}

/** Verify overwrite/delete permission: reject if an existing creator (createdBy) exists and the actor isn't them/an admin.
 *  Allowed for new names or legacy entries (no recorded creator). */
async function assertCanManageTemplate(name: string, actorEmail?: string): Promise<void> {
  const meta = await readMeta();
  const owner = meta[name]?.createdBy;
  if (owner && !(await canManageAsync(owner, actorEmail))) {
    throw new Error("이 이메일을 수정·삭제할 권한이 없습니다 (생성자 또는 관리자만 가능).");
  }
}

/** Serialize the read-modify-write of _meta.json + atomic write to prevent concurrent-write collisions. */
async function mutateMeta(fn: (m: MetaFile) => MetaFile | Promise<MetaFile>): Promise<void> {
  return withFileLock(META_LOCK_KEY, async () => {
    const cur = await readMeta();
    const next = await fn(cur);
    await atomicWrite(META_PATH, JSON.stringify(next, null, 2));
  });
}

export async function listTemplates(): Promise<TemplateMeta[]> {
  const meta = await readMeta();
  const files = await fs.readdir(TEMPLATES_DIR);
  const jsonNames = new Set(files.filter((f) => f.endsWith(".json") && f !== "_meta.json").map((f) => f.replace(/\.json$/, "")));
  const out: TemplateMeta[] = [];
  for (const f of files) {
    if (!f.endsWith(".html")) continue;
    const name = f.replace(/\.html$/, "");
    const stat = await fs.stat(path.join(TEMPLATES_DIR, f));
    const m = meta[name] ?? {};
    out.push({
      name,
      title: displayTitle(name, m),
      subject: m.subject ?? DEFAULT_SUBJECT,
      description: m.description ?? DEFAULT_DESCRIPTION,
      size: stat.size,
      composed: jsonNames.has(name),
      createdBy: m.createdBy,
      lastModifiedBy: m.lastModifiedBy,
      lastModifiedAt: m.lastModifiedAt,
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** Meta of one email (for title/modified-time lookups). */
export async function getTemplateBody(name: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return null;
  try {
    return await fs.readFile(path.join(TEMPLATES_DIR, `${name}.html`), "utf-8");
  } catch {
    return null;
  }
}

function wrapHtml(subject: string, bodyInner: string): string {
  return (
    `<!DOCTYPE html>\n<html lang="ko"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
    `<meta name="color-scheme" content="light">` +
    `<title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0; padding:0; background-color:#f5f5f5; font-family:${FONT_FAMILY}; -webkit-font-smoothing:antialiased;">` +
    bodyInner +
    `</body></html>`
  );
}

export async function buildFullHtml(name: string): Promise<{ subject: string; html: string; title: string; lastModifiedAt?: string } | null> {
  const body = await getTemplateBody(name);
  if (!body) return null;
  const m = (await readMeta())[name] ?? {};
  const subject = m.subject ?? DEFAULT_SUBJECT;
  return { subject, html: wrapHtml(subject, body), title: displayTitle(name, m), lastModifiedAt: m.lastModifiedAt };
}

/** Render a spec (JSON) straight to full HTML without saving (for preview). Legacy specs are migrated to the tree. */
export function buildFullHtmlFromSpec(spec: TemplateSpec): { subject: string; html: string } {
  const subject = spec.subject?.trim() || DEFAULT_SUBJECT;
  return { subject, html: wrapHtml(subject, renderTemplate(migrateSpec(spec))) };
}

/** Load the block-composer spec (for re-editing). null if none. Legacy specs are converted to the tree model and returned. */
export async function getTemplateSpec(name: string): Promise<TemplateSpec | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(TEMPLATES_DIR, `${name}.json`), "utf-8"));
    return migrateSpec(parsed);
  } catch {
    return null;
  }
}

/** Whether an email (template) of the same name exists — based on meta or file. */
export async function templateExists(name: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return false;
  const meta = await readMeta();
  if (meta[name]) return true;
  try { await fs.access(path.join(TEMPLATES_DIR, `${name}.html`)); return true; } catch { return false; }
}

/** Prevent silent same-name overwrite on new save. Edit mode (overwrite=true) passes through. */
async function assertNotDuplicate(name: string, overwrite: boolean): Promise<void> {
  if (overwrite) return;
  if (await templateExists(name)) {
    throw new Error("이미 같은 이름의 이메일이 있습니다 — 다른 이름을 쓰거나 기존 항목을 편집하세요");
  }
}

/** Save block-builder output: {name}.json (spec) + {name}.html (render) + _meta.json (title/description + audit). */
/** Resolve the id for a save: existing id when editing, a fresh auto id for new emails. */
function resolveSaveName(name: string | undefined, overwrite: boolean): string {
  const n = String(name ?? "").trim();
  if (overwrite) {
    if (!NAME_RE.test(n)) throw new Error("잘못된 이메일 ID");
    return n;
  }
  // New email: ids are generated. A hand-typed name is still accepted (legacy upload API).
  return n && NAME_RE.test(n) ? n : newTemplateId();
}

export async function saveComposedTemplate(
  rawName: string | undefined,
  spec: TemplateSpec,
  description = "",
  actorEmail?: string,
  opts: { overwrite?: boolean; title?: string } = {},
): Promise<string> {
  const name = resolveSaveName(rawName, !!opts.overwrite);
  if (!spec || !Array.isArray(spec.blocks) || spec.blocks.length === 0) {
    throw new Error("블록이 하나도 없습니다");
  }
  if (spec.blocks.length > 100) {
    throw new Error("블록이 너무 많습니다 (최대 100개)");
  }
  if (!spec.subject?.trim()) throw new Error("이메일 제목을 입력하세요");
  await assertNotDuplicate(name, !!opts.overwrite);
  await assertCanManageTemplate(name, actorEmail);

  const mspec = migrateSpec(spec); // normalize to the tree model before saving
  const body = renderTemplate(mspec);
  await atomicWrite(path.join(TEMPLATES_DIR, `${name}.html`), body);
  await atomicWrite(path.join(TEMPLATES_DIR, `${name}.json`), JSON.stringify(mspec, null, 2));
  await mutateMeta((m) => {
    const prev = m[name] ?? {};
    m[name] = {
      ...prev,
      ...(opts.title !== undefined ? { title: opts.title.trim() || undefined } : {}),
      subject: spec.subject.trim(),
      description: description.trim(),
      createdBy: prev.createdBy ?? actorEmail,
      lastModifiedBy: actorEmail ?? prev.lastModifiedBy,
      lastModifiedAt: new Date().toISOString(),
    };
    return m;
  });
  return name;
}

export async function saveTemplate(
  rawName: string | undefined,
  subject: string,
  body: string,
  description = "",
  actorEmail?: string,
  opts: { overwrite?: boolean; title?: string } = {},
): Promise<string> {
  const name = resolveSaveName(rawName, !!opts.overwrite);
  if (!body.trim()) throw new Error("본문이 비어 있습니다");
  await assertNotDuplicate(name, !!opts.overwrite);
  await assertCanManageTemplate(name, actorEmail);
  await atomicWrite(path.join(TEMPLATES_DIR, `${name}.html`), body);
  // Converting a block email to plain HTML: drop the spec so it is edited as HTML from now on.
  await fs.unlink(path.join(TEMPLATES_DIR, `${name}.json`)).catch(() => {});
  await mutateMeta((m) => {
    const prev = m[name] ?? {};
    m[name] = {
      ...prev,
      ...(opts.title !== undefined ? { title: opts.title.trim() || undefined } : {}),
      subject: subject.trim() || DEFAULT_SUBJECT,
      description: description.trim(),
      createdBy: prev.createdBy ?? actorEmail,
      lastModifiedBy: actorEmail ?? prev.lastModifiedBy,
      lastModifiedAt: new Date().toISOString(),
    };
    return m;
  });
  return name;
}

/** Copy an email (html + spec) into a new id. Anyone may duplicate; the copy belongs to the actor. */
export async function duplicateTemplate(name: string, actorEmail?: string): Promise<{ name: string; title: string }> {
  if (!NAME_RE.test(name)) throw new Error("잘못된 이메일 ID");
  const body = await getTemplateBody(name);
  if (body === null) throw new Error("원본 이메일을 찾을 수 없습니다");
  const spec = await getTemplateSpec(name);
  const src = (await readMeta())[name] ?? {};
  const id = newTemplateId();
  const title = `${displayTitle(name, src)} (사본)`;
  await atomicWrite(path.join(TEMPLATES_DIR, `${id}.html`), body);
  if (spec) await atomicWrite(path.join(TEMPLATES_DIR, `${id}.json`), JSON.stringify(spec, null, 2));
  const now = new Date().toISOString();
  await mutateMeta((m) => {
    m[id] = {
      title,
      subject: src.subject ?? DEFAULT_SUBJECT,
      description: src.description ?? "",
      createdBy: actorEmail,
      lastModifiedBy: actorEmail,
      lastModifiedAt: now,
    };
    return m;
  });
  return { name: id, title };
}

/** Permanent delete: removes {name}.html + {name}.json + the _meta entry. Irreversible.
 *  Creator/admin only — legacy entries with no creator record are admin-only (prevents accidental deletion). */
export async function deleteTemplate(name: string, actorEmail?: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("잘못된 이메일 이름");
  const owner = (await readMeta())[name]?.createdBy;
  const allowed = owner ? await canManageAsync(owner, actorEmail) : await isAdminAsync(actorEmail);
  if (!allowed) {
    throw new Error("이 이메일을 삭제할 권한이 없습니다 (만든 사람 또는 관리자만 가능).");
  }
  await fs.unlink(path.join(TEMPLATES_DIR, `${name}.html`)).catch(() => {});
  await fs.unlink(path.join(TEMPLATES_DIR, `${name}.json`)).catch(() => {});
  await mutateMeta((m) => {
    delete m[name];
    return m;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
