/**
 * 수신거부/반송/스팸신고 억제 목록.
 * 저장: data/suppression.json — { [emailLower]: { reason, at, source } }
 * 발송 dedupe 단계에서 여기에 있는 주소를 제외한다.
 * 출처: 사용자 수신거부(/api/unsubscribe), Resend webhook(bounced/complained), 직접 추가(manual — 메일 등으로 받은 거부 요청).
 * 범위: 회사 전체. 어떤 발신자로 보내든 이 목록의 주소는 제외된다.
 * Resend 도 리전 단위 자동 suppression 을 하지만, 우리 쪽 발송 단계에서 선제 제외 + 트래킹 표시를 위해 별도 유지.
 */
import fs from "fs/promises";
import path from "path";
import { atomicWrite, withFileLock, readJsonSafe } from "./atomic";

const DATA_DIR = path.join(process.cwd(), "data");
const PATH = path.join(DATA_DIR, "suppression.json");
const LOCK_KEY = "suppression";

export type SuppressionReason = "unsubscribe" | "bounced" | "complained" | "manual";
export type SuppressionEntry = { email: string; reason: SuppressionReason; at: string; source?: string; updatedAt?: string };
type Store = Record<string, SuppressionEntry>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function norm(email: string): string {
  return String(email ?? "").toLowerCase().trim();
}

async function read(): Promise<Store> {
  const s = await readJsonSafe<Store>(PATH, {});
  return s && typeof s === "object" ? s : {};
}

/** Severity: a later complaint/bounce must not stay hidden behind an earlier unsubscribe. */
const REASON_RANK: Record<SuppressionReason, number> = { manual: 1, unsubscribe: 1, bounced: 2, complained: 3 };

/** Reasons a person may lift themselves (resubscribe link). Bounces/complaints need an admin. */
export function canSelfResubscribe(reason: SuppressionReason | undefined): boolean {
  return reason === "unsubscribe" || reason === "manual";
}

/**
 * 억제 목록에 추가(멱등). 이미 있으면 최초 기록(at)은 유지하되,
 * 더 심각한 사유(반송·스팸신고)가 들어오면 사유를 올린다.
 */
export async function suppress(email: string, reason: SuppressionReason, source?: string): Promise<void> {
  const e = norm(email);
  if (!EMAIL_RE.test(e)) return;
  await withFileLock(LOCK_KEY, async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const store = await read();
    const cur = store[e];
    if (!cur) {
      store[e] = { email: e, reason, at: new Date().toISOString(), source };
    } else if (REASON_RANK[reason] > REASON_RANK[cur.reason]) {
      store[e] = { ...cur, reason, source: source ?? cur.source, updatedAt: new Date().toISOString() };
    } else {
      return;
    }
    await atomicWrite(PATH, JSON.stringify(store, null, 2));
  });
}

export async function getSuppression(email: string): Promise<SuppressionEntry | null> {
  return (await read())[norm(email)] ?? null;
}

/** 억제 해제(관리자/오등록 복구용). */
export async function unsuppress(email: string): Promise<void> {
  const e = norm(email);
  await withFileLock(LOCK_KEY, async () => {
    const store = await read();
    if (store[e]) {
      delete store[e];
      await atomicWrite(PATH, JSON.stringify(store, null, 2));
    }
  });
}

export async function isSuppressed(email: string): Promise<boolean> {
  const store = await read();
  return !!store[norm(email)];
}

/** 여러 이메일 중 억제된 것들의 Set 을 한 번에 반환(발송 dedupe 용). */
export async function suppressedSet(emails: string[]): Promise<Set<string>> {
  const store = await read();
  const out = new Set<string>();
  for (const raw of emails) {
    const e = norm(raw);
    if (store[e]) out.add(e);
  }
  return out;
}

export async function listSuppressions(): Promise<SuppressionEntry[]> {
  const store = await read();
  return Object.values(store).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}
