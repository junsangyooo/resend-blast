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
  composed: boolean; // 블록 조립기로 만들어 spec(json)이 있는지
  archived: boolean; // 보관함으로 이동되어 메인 목록에서 숨김
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

/** 덮어쓰기/삭제 권한 검증: 기존 생성자(createdBy)가 있고 본인/관리자가 아니면 거부.
 *  신규 이름이거나 레거시(생성자 미기록)는 허용. */
async function assertCanManageTemplate(name: string, actorEmail?: string): Promise<void> {
  const meta = await readMeta();
  const owner = meta[name]?.createdBy;
  if (owner && !(await canManageAsync(owner, actorEmail))) {
    throw new Error("이 이메일을 수정·삭제할 권한이 없습니다 (생성자 또는 관리자만 가능).");
  }
}

/** _meta.json 의 read-modify-write 를 직렬화 + atomic write 로 동시 쓰기 충돌 방지. */
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

/** spec(JSON)을 저장 안 하고 즉시 풀 HTML로 렌더 (미리보기용). 레거시 spec 은 트리로 마이그레이션. */
export function buildFullHtmlFromSpec(spec: TemplateSpec): { subject: string; html: string } {
  const subject = spec.subject?.trim() || DEFAULT_SUBJECT;
  return { subject, html: wrapHtml(subject, renderTemplate(migrateSpec(spec))) };
}

/** 블록 조립기 spec 로드 (재편집용). 없으면 null. 레거시 spec 은 트리 모델로 변환해 반환. */
export async function getTemplateSpec(name: string): Promise<TemplateSpec | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(TEMPLATES_DIR, `${name}.json`), "utf-8"));
    return migrateSpec(parsed);
  } catch {
    return null;
  }
}

/** 동명 이메일(템플릿) 존재 여부 — 메타 또는 파일 기준. */
export async function templateExists(name: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return false;
  const meta = await readMeta();
  if (meta[name]) return true;
  try { await fs.access(path.join(TEMPLATES_DIR, `${name}.html`)); return true; } catch { return false; }
}

/** 신규 저장 시 동명 무경고 덮어쓰기 방지. 편집 모드(overwrite=true)는 통과. */
async function assertNotDuplicate(name: string, overwrite: boolean): Promise<void> {
  if (overwrite) return;
  if (await templateExists(name)) {
    throw new Error("이미 같은 이름의 이메일이 있습니다 — 다른 이름을 쓰거나 기존 항목을 편집하세요");
  }
}

/** 블록 조립기 결과 저장: {name}.json(spec) + {name}.html(렌더) + _meta.json(제목/설명+감사). */
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

  const mspec = migrateSpec(spec); // 트리 모델로 정규화 후 저장
  const body = renderTemplate(mspec);
  await atomicWrite(path.join(TEMPLATES_DIR, `${name}.html`), body);
  await atomicWrite(path.join(TEMPLATES_DIR, `${name}.json`), JSON.stringify(mspec, null, 2));
  await mutateMeta((m) => {
    const prev = m[name] ?? {};
    m[name] = {
      ...prev,
      subject: spec.subject.trim(),
      description: description.trim(),
      // 새로 저장(또는 덮어쓰기) 시 항상 활성화 — 보관 상태 잔재가 새 템플릿을 숨기는 버그 방지
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
      // 새로 저장(또는 덮어쓰기) 시 항상 활성화 — 보관 상태 잔재가 새 템플릿을 숨기는 버그 방지
      archived: false,
      createdBy: prev.createdBy ?? actorEmail,
      lastModifiedBy: actorEmail ?? prev.lastModifiedBy,
      lastModifiedAt: new Date().toISOString(),
    };
    return m;
  });
}

/** 보관함 토글: _meta.json 의 archived 플래그만 변경(파일은 유지).
 *  보관/복원은 가역적이라 누구나 가능(영구 삭제만 생성자/관리자로 제한). */
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

/** 영구 삭제: {name}.html + {name}.json + _meta 항목 제거. 되돌릴 수 없음. 생성자/관리자만. */
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
