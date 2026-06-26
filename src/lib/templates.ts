import fs from "fs/promises";
import path from "path";
import { renderTemplate, migrateSpec, type TemplateSpec } from "./blocks";
import { atomicWrite, withFileLock } from "./atomic";
import { canManageAsync } from "./admins";
import { brand } from "../brand.config";

const TEMPLATES_DIR = path.join(process.cwd(), "templates");
const META_PATH = path.join(TEMPLATES_DIR, "_meta.json");
const META_LOCK_KEY = "templates:meta";

const DEFAULT_SUBJECT = brand.templates.defaultSubject;
const DEFAULT_DESCRIPTION = "";

const FONT_FAMILY = "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

export type TemplateMeta = {
  name: string;
  subject: string;
  description: string;
  size: number;
  composed: boolean; // whether it was built with the block composer and has a spec (json)
  archived: boolean; // moved to the archive and hidden from the main list
  createdBy?: string;
  lastModifiedBy?: string;
  lastModifiedAt?: string;
};

type MetaEntry = {
  subject?: string;
  description?: string;
  archived?: boolean;
  createdBy?: string;
  lastModifiedBy?: string;
  lastModifiedAt?: string;
};
type MetaFile = Record<string, MetaEntry>;

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
      subject: m.subject ?? DEFAULT_SUBJECT,
      description: m.description ?? DEFAULT_DESCRIPTION,
      size: stat.size,
      composed: jsonNames.has(name),
      archived: m.archived ?? false,
      createdBy: m.createdBy,
      lastModifiedBy: m.lastModifiedBy,
      lastModifiedAt: m.lastModifiedAt,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

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

export async function buildFullHtml(name: string): Promise<{ subject: string; html: string } | null> {
  const body = await getTemplateBody(name);
  if (!body) return null;
  const meta = await readMeta();
  const subject = meta[name]?.subject ?? DEFAULT_SUBJECT;
  return { subject, html: wrapHtml(subject, body) };
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

/** Save block-composer output: {name}.json(spec) + {name}.html(render) + _meta.json(subject/description+audit). */
export async function saveComposedTemplate(
  name: string,
  spec: TemplateSpec,
  description = "",
  actorEmail?: string,
  opts: { overwrite?: boolean } = {},
) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error("이메일 이름은 영문/숫자/하이픈/언더스코어만 가능합니다");
  }
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
      subject: spec.subject.trim(),
      description: description.trim(),
      // Always activate on (re)save — prevents a leftover archived flag from hiding the new template
      archived: false,
      createdBy: prev.createdBy ?? actorEmail,
      lastModifiedBy: actorEmail ?? prev.lastModifiedBy,
      lastModifiedAt: new Date().toISOString(),
    };
    return m;
  });
}

export async function saveTemplate(
  name: string,
  subject: string,
  body: string,
  description = "",
  actorEmail?: string,
  opts: { overwrite?: boolean } = {},
) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error("이메일 이름은 영문/숫자/하이픈/언더스코어만 가능합니다");
  }
  if (!body.trim()) throw new Error("본문이 비어 있습니다");
  await assertNotDuplicate(name, !!opts.overwrite);
  await assertCanManageTemplate(name, actorEmail);
  await atomicWrite(path.join(TEMPLATES_DIR, `${name}.html`), body);
  await mutateMeta((m) => {
    const prev = m[name] ?? {};
    m[name] = {
      ...prev,
      subject: subject.trim() || DEFAULT_SUBJECT,
      description: description.trim(),
      // Always activate on (re)save — prevents a leftover archived flag from hiding the new template
      archived: false,
      createdBy: prev.createdBy ?? actorEmail,
      lastModifiedBy: actorEmail ?? prev.lastModifiedBy,
      lastModifiedAt: new Date().toISOString(),
    };
    return m;
  });
}

/** Archive toggle: only flips the archived flag in _meta.json (files are kept).
 *  Archive/restore is reversible so anyone can do it (only permanent delete is restricted to creator/admin). */
export async function setArchived(name: string, archived: boolean, actorEmail?: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("잘못된 이메일 이름");
  await mutateMeta((m) => {
    m[name] = {
      ...(m[name] ?? {}),
      archived,
      lastModifiedBy: actorEmail ?? m[name]?.lastModifiedBy,
      lastModifiedAt: new Date().toISOString(),
    };
    return m;
  });
}

/** Permanent delete: removes {name}.html + {name}.json + the _meta entry. Irreversible. Creator/admin only. */
export async function deleteTemplate(name: string, actorEmail?: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("잘못된 이메일 이름");
  await assertCanManageTemplate(name, actorEmail);
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
