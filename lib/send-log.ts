/**
 * 발송 로그 — per-send 파일.
 * 저장: data/sends/{id}.json
 * 동시 발송 충돌 없음 (파일이 발송마다 새로 생성).
 * 발송 중에는 partial 로 기록 → 완료 시 final 로 갱신.
 */
import fs from "fs/promises";
import path from "path";
import { customAlphabet } from "nanoid";
import { atomicWrite, withFileLock, readJsonSafe } from "./atomic";
import { SEND_MIN_GAP_MS } from "./config";

const SENDS_DIR = path.join(process.cwd(), "data", "sends");

const idGen = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);
const ID_RE = /^[0-9a-zA-Z._-]+$/;

export type SendStatus = "running" | "completed" | "aborted";

export type SendRecipient = {
  email: string;
  name?: string;
  listSlug?: string | null;
  resendId?: string;
  status: "pending" | "sent" | "failed";
  error?: string;
  sentAt?: string;
  /** Resend 라이브 상태(delivered/opened/clicked/bounced/complained…). webhook 또는 조회로 영속. */
  liveStatus?: string;
  liveStatusAt?: string;
};

export type SendRecord = {
  id: string;
  createdAt: string;
  finishedAt?: string;
  status: SendStatus;
  sentBy: string;
  templateName: string;
  subject: string;
  from: string;
  replyTo: string;
  listSlugs: string[];
  adhocCount: number;
  recipients: SendRecipient[];
  summary: { total: number; sent: number; failed: number };
  /** 내용 지문 — 중복 발송(멱등성) 검사용. */
  hash?: string;
  /** 발송 중 중단 요청 플래그 — 발송 루프가 매 반복 확인. */
  abortRequested?: boolean;
  /** 광고성 발송 여부((광고) 제목 접두 + 수신거부 강제). */
  isAd?: boolean;
  /** 발송 종류. test 는 본인 검수용, followup 은 재발송. */
  kind?: "normal" | "test" | "followup";
  /** 팔로업(재발송) 시 원본 send id. */
  sourceSendId?: string;
  /** 억제목록으로 제외된 수신자 수. */
  excludedSuppressed?: number;
};

/** 수신자 1명의 현재 단계(상호 배타). liveStatus 우선, 없으면 send status. */
export type StatusStage = "delivered" | "sent" | "bounced" | "failed" | "pending";
export function recipientStage(r: Pick<SendRecipient, "status" | "liveStatus">): StatusStage {
  if (r.status === "failed") return "failed";
  if (r.status === "pending") return "pending";
  const ls = (r.liveStatus ?? "").toLowerCase();
  if (ls === "bounced" || ls === "complained") return "bounced";
  if (ls === "delivered" || ls === "opened" || ls === "clicked") return "delivered";
  return "sent"; // 전송됐으나 아직 전달 확인 전
}
export type StatusBreakdown = { delivered: number; sent: number; bounced: number; failed: number; pending: number };
export function statusBreakdown(recipients: SendRecipient[]): StatusBreakdown {
  const b: StatusBreakdown = { delivered: 0, sent: 0, bounced: 0, failed: 0, pending: 0 };
  for (const r of recipients ?? []) b[recipientStage(r)]++;
  return b;
}

export type SendSummary = Omit<SendRecord, "recipients"> & { recipientCount: number; statusBreakdown: StatusBreakdown };

export function newSendId(): string {
  // ISO timestamp + 6char nanoid → 시간순 정렬 + 고유
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}_${idGen()}`;
}

async function ensureDir() {
  await fs.mkdir(SENDS_DIR, { recursive: true });
}

function pathFor(id: string): string {
  if (!ID_RE.test(id)) throw new Error("잘못된 send id");
  return path.join(SENDS_DIR, `${id}.json`);
}

export async function createSend(record: SendRecord): Promise<void> {
  await ensureDir();
  await atomicWrite(pathFor(record.id), JSON.stringify(record, null, 2));
}

export async function getSend(id: string): Promise<SendRecord | null> {
  if (!ID_RE.test(id)) return null;
  return readJsonSafe<SendRecord | null>(pathFor(id), null);
}

export async function updateSend(
  id: string,
  updater: (r: SendRecord) => SendRecord
): Promise<SendRecord> {
  return withFileLock(`send:${id}`, async () => {
    const cur = await getSend(id);
    if (!cur) throw new Error("send not found");
    const next = updater(cur);
    await atomicWrite(pathFor(id), JSON.stringify(next, null, 2));
    return next;
  });
}

export async function listSends(): Promise<SendSummary[]> {
  await ensureDir();
  const files = await fs.readdir(SENDS_DIR);
  const out: SendSummary[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const id = f.replace(/\.json$/, "");
    if (!ID_RE.test(id)) continue;
    const data = await readJsonSafe<SendRecord | null>(path.join(SENDS_DIR, f), null);
    if (!data) continue;
    const { recipients, ...rest } = data;
    out.push({ ...rest, recipientCount: recipients?.length ?? 0, statusBreakdown: statusBreakdown(recipients) });
  }
  return out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * 발송 중 서버가 죽거나 deploy 재시작이 끼어들면 `running` 상태로 영원히 갇히는 레코드가 생긴다.
 * running 레코드를 aborted 로 마킹하되, cutoff 를 **수신자 수에 비례해 동적**으로 잡아
 * 대량 발송이 1시간을 넘겨도 진행 중인 진짜 발송을 오마킹하지 않는다.
 * 예) 5000명 × 220ms ≈ 18.3분 → cutoff = 그 2배 + 30분 마진.
 */
export async function cleanupStaleSends(minAgeMs = 60 * 60 * 1000): Promise<number> {
  await ensureDir();
  const files = await fs.readdir(SENDS_DIR);
  const now = Date.now();
  let fixed = 0;
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const id = f.replace(/\.json$/, "");
    if (!ID_RE.test(id)) continue;
    const data = await readJsonSafe<SendRecord | null>(path.join(SENDS_DIR, f), null);
    if (!data) continue;
    if (data.status !== "running") continue;
    if (data.finishedAt) continue; // 이미 끝남 (status만 누락)
    const created = new Date(data.createdAt).getTime();
    if (!Number.isFinite(created)) continue;
    // 최근까지 진행 흔적이 있으면(마지막 sentAt 이 10분 이내) 진짜 살아있는 발송 → 건드리지 않는다.
    // (느린/재시도/경합 발송이 추정시간을 넘겨도 오판해 aborted 로 덮지 않게 한다.)
    const progressed = (data.summary?.sent ?? 0) + (data.summary?.failed ?? 0);
    if (progressed > 0) {
      const lastSentAt = (data.recipients ?? [])
        .map((r) => (r.sentAt ? new Date(r.sentAt).getTime() : 0))
        .reduce((a, b) => Math.max(a, b), 0);
      const idleMs = now - (lastSentAt || created);
      if (idleMs < 10 * 60 * 1000) continue; // 10분 내 활동 → 진행 중
    }
    // 동적 cutoff: 예상 소요시간(수신자 × 간격 × 재시도여유 3배)의 2배 + 30분, 최소 minAgeMs.
    const estMs = (data.summary?.total ?? data.recipients?.length ?? 0) * SEND_MIN_GAP_MS * 3;
    const cutoffMs = Math.max(minAgeMs, estMs * 2 + 30 * 60 * 1000);
    if (now - created < cutoffMs) continue;
    try {
      await updateSend(id, (r) => ({
        ...r,
        status: "aborted",
        finishedAt: r.finishedAt ?? new Date().toISOString(),
      }));
      fixed++;
    } catch {
      // 동시 수정이 끼면 다음 사이클에서 재시도
    }
  }
  return fixed;
}

/**
 * 모든 send의 resend id → 메타 매핑. 트래킹 상태 lookup에 사용.
 * 사이드바가 15초마다 폴링하므로 짧은 TTL 캐시. updateSend 가 진행 중 발송에 resendId 를
 * 새로 추가해도 다음 폴링(최대 INDEX_CACHE_TTL_MS) 안에 반영된다.
 */
const INDEX_CACHE_TTL_MS = 5_000;
let _idxCache: {
  at: number;
  data: Map<string, { sendId: string; email: string; listSlug?: string | null }>;
} | null = null;

export async function buildResendIdIndex(): Promise<
  Map<string, { sendId: string; email: string; listSlug?: string | null }>
> {
  if (_idxCache && Date.now() - _idxCache.at < INDEX_CACHE_TTL_MS) {
    return _idxCache.data;
  }
  await ensureDir();
  const files = await fs.readdir(SENDS_DIR);
  const idx = new Map<string, { sendId: string; email: string; listSlug?: string | null }>();
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const data = await readJsonSafe<SendRecord | null>(path.join(SENDS_DIR, f), null);
    if (!data) continue;
    for (const r of data.recipients) {
      if (r.resendId) idx.set(r.resendId, { sendId: data.id, email: r.email, listSlug: r.listSlug ?? null });
    }
  }
  _idxCache = { at: Date.now(), data: idx };
  return idx;
}

/** 캐시 무효화 — 진행 중 발송이 새 resendId 를 추가했거나 webhook 직후 즉시 반영 필요할 때. */
export function invalidateResendIdIndex(): void {
  _idxCache = null;
}

// ── 발송 성과 집계 (오픈율/클릭률 등) ──
export type SendMetrics = {
  total: number;
  sent: number;
  failed: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
};

/** 레코드의 recipients 에서 라이브 상태 기준 집계. liveStatus 우선, 없으면 send status. */
export function computeMetrics(rec: SendRecord): SendMetrics {
  const m: SendMetrics = { total: 0, sent: 0, failed: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 };
  for (const r of rec.recipients ?? []) {
    m.total++;
    if (r.status === "failed") m.failed++;
    else if (r.status === "sent") m.sent++;
    const ls = (r.liveStatus ?? "").toLowerCase();
    if (ls === "delivered") m.delivered++;
    else if (ls === "opened") m.opened++;
    else if (ls === "clicked") m.clicked++;
    else if (ls === "bounced") m.bounced++;
    else if (ls === "complained") m.complained++;
  }
  return m;
}

/** 사용자의 최근 window(ms) 내 발송 시도 수(레이트리밋). 시도=summary.total 합. test 발송은 제외. */
export async function userSendVolume(email: string, windowMs: number): Promise<number> {
  await ensureDir();
  const files = await fs.readdir(SENDS_DIR);
  const since = Date.now() - windowMs;
  const target = email.toLowerCase();
  let total = 0;
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const data = await readJsonSafe<SendRecord | null>(path.join(SENDS_DIR, f), null);
    if (!data || data.kind === "test") continue;
    if ((data.sentBy ?? "").toLowerCase() !== target) continue;
    const t = new Date(data.createdAt).getTime();
    if (!Number.isFinite(t) || t < since) continue;
    total += data.summary?.total ?? data.recipients?.length ?? 0;
  }
  return total;
}

/** 멱등성: 같은 hash 의 발송이 최근 window 안에 있으면 그 레코드 반환(중복 발송 방지). */
export async function findRecentSendByHash(hash: string, windowMs: number): Promise<SendRecord | null> {
  if (!hash) return null;
  await ensureDir();
  const files = await fs.readdir(SENDS_DIR);
  const since = Date.now() - windowMs;
  let best: SendRecord | null = null;
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const data = await readJsonSafe<SendRecord | null>(path.join(SENDS_DIR, f), null);
    if (!data || data.hash !== hash) continue;
    const t = new Date(data.createdAt).getTime();
    if (!Number.isFinite(t) || t < since) continue;
    if (!best || (data.createdAt ?? "") > (best.createdAt ?? "")) best = data;
  }
  return best;
}

/**
 * 라이브 상태 진행 순위. 웹훅은 순서 보장이 없어(예: opened 뒤 delivered 도착)
 * 더 진전된 상태를 이전 상태로 되돌리면 안 된다. bounced/complained 는 종단(최상위).
 */
const LIVE_STATUS_RANK: Record<string, number> = {
  sent: 1, queued: 1, delivery_delayed: 1,
  delivered: 2, opened: 3, clicked: 4,
  bounced: 5, complained: 5,
};
function rankStatus(s?: string): number {
  return LIVE_STATUS_RANK[(s ?? "").toLowerCase()] ?? 0;
}
/** next 상태를 current 위에 적용해도 되는지(역전 금지). 동순위는 허용(타임스탬프 갱신). */
export function shouldApplyLiveStatus(current: string | undefined, next: string): boolean {
  return rankStatus(next) >= rankStatus(current);
}

/** webhook/조회로 받은 라이브 상태를 resendId 기준으로 해당 레코드에 영속(순서 역전 방지). */
export async function applyLiveStatus(resendId: string, status: string): Promise<boolean> {
  const idx = await buildResendIdIndex();
  const hit = idx.get(resendId);
  if (!hit) return false;
  const newStatus = status.toLowerCase();
  const at = new Date().toISOString();
  await updateSend(hit.sendId, (r) => ({
    ...r,
    recipients: r.recipients.map((x) =>
      x.resendId === resendId && shouldApplyLiveStatus(x.liveStatus, newStatus)
        ? { ...x, liveStatus: newStatus, liveStatusAt: at }
        : x
    ),
  })).catch(() => {});
  return true;
}

/** 발송 중단 요청 플래그 세팅. 발송 루프가 다음 반복에서 감지해 종료. */
export async function requestAbort(sendId: string): Promise<SendRecord | null> {
  return updateSend(sendId, (r) =>
    r.status === "running" ? { ...r, abortRequested: true } : r
  ).catch(() => null);
}

