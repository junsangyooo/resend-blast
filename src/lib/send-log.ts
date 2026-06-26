/**
 * Send log — per-send file.
 * Storage: data/sends/{id}.json
 * No concurrent-send collisions (a fresh file is created per send).
 * Recorded as partial during sending → updated to final on completion.
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
  /** Resend live status (delivered/opened/clicked/bounced/complained…). Persisted via webhook or lookup. */
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
  /** Content fingerprint — for duplicate-send (idempotency) checks. */
  hash?: string;
  /** Abort-request flag during sending — checked by the send loop every iteration. */
  abortRequested?: boolean;
  /** Whether it's a promotional send ((광고) subject prefix + forced unsubscribe). */
  isAd?: boolean;
  /** Send kind. test is for self-review, followup is a resend. */
  kind?: "normal" | "test" | "followup";
  /** Original send id for a followup (resend). */
  sourceSendId?: string;
  /** Number of recipients excluded by the suppression list. */
  excludedSuppressed?: number;
};

/** Current stage of one recipient (mutually exclusive). liveStatus takes priority, else send status. */
export type StatusStage = "delivered" | "sent" | "bounced" | "failed" | "pending";
export function recipientStage(r: Pick<SendRecipient, "status" | "liveStatus">): StatusStage {
  if (r.status === "failed") return "failed";
  if (r.status === "pending") return "pending";
  const ls = (r.liveStatus ?? "").toLowerCase();
  if (ls === "bounced" || ls === "complained") return "bounced";
  if (ls === "delivered" || ls === "opened" || ls === "clicked") return "delivered";
  return "sent"; // sent but delivery not yet confirmed
}
export type StatusBreakdown = { delivered: number; sent: number; bounced: number; failed: number; pending: number };
export function statusBreakdown(recipients: SendRecipient[]): StatusBreakdown {
  const b: StatusBreakdown = { delivered: 0, sent: 0, bounced: 0, failed: 0, pending: 0 };
  for (const r of recipients ?? []) b[recipientStage(r)]++;
  return b;
}

export type SendSummary = Omit<SendRecord, "recipients"> & { recipientCount: number; statusBreakdown: StatusBreakdown };

export function newSendId(): string {
  // ISO timestamp + 6-char nanoid → chronological sort + uniqueness
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
 * If the server dies mid-send or a deploy restart cuts in, records get stuck in `running` forever.
 * Mark such running records as aborted, but set the cutoff **dynamically in proportion to recipient count**
 * so a bulk send that runs past 1 hour isn't mis-marked while a real send is still in progress.
 * e.g. 5000 recipients × 220ms ≈ 18.3 min → cutoff = 2× that + 30 min margin.
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
    if (data.finishedAt) continue; // already finished (only status missing)
    const created = new Date(data.createdAt).getTime();
    if (!Number.isFinite(created)) continue;
    // If there's been recent progress (last sentAt within 10 min), it's a genuinely live send → don't touch it.
    // (Prevents mis-marking slow/retrying/contended sends as aborted even when they exceed the estimate.)
    const progressed = (data.summary?.sent ?? 0) + (data.summary?.failed ?? 0);
    if (progressed > 0) {
      const lastSentAt = (data.recipients ?? [])
        .map((r) => (r.sentAt ? new Date(r.sentAt).getTime() : 0))
        .reduce((a, b) => Math.max(a, b), 0);
      const idleMs = now - (lastSentAt || created);
      if (idleMs < 10 * 60 * 1000) continue; // activity within 10 min → in progress
    }
    // Dynamic cutoff: 2× the estimated duration (recipients × gap × 3 retry margin) + 30 min, at least minAgeMs.
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
      // if a concurrent update cuts in, retry next cycle
    }
  }
  return fixed;
}

/**
 * Map of every send's resend id → meta. Used for tracking-status lookups.
 * Short-TTL cache since the sidebar polls every 15s. Even when updateSend adds a new resendId
 * to an in-progress send, it's reflected within the next poll (at most INDEX_CACHE_TTL_MS).
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

/** Invalidate the cache — when an in-progress send added a new resendId, or right after a webhook needs immediate reflection. */
export function invalidateResendIdIndex(): void {
  _idxCache = null;
}

// ── Send performance aggregation (open rate / click rate, etc.) ──
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

/** Aggregate from a record's recipients by live status. liveStatus takes priority, else send status. */
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

/** Number of send attempts by a user within the recent window(ms) (rate limit). attempt = sum of summary.total. test sends excluded. */
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

/** Idempotency: if a send with the same hash exists within the recent window, return that record (prevents duplicate sends). */
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
 * Live-status progression ranking. Webhooks aren't order-guaranteed (e.g. delivered arrives after opened),
 * so a more-advanced status must not be rolled back to an earlier one. bounced/complained are terminal (top rank).
 */
const LIVE_STATUS_RANK: Record<string, number> = {
  sent: 1, queued: 1, delivery_delayed: 1,
  delivered: 2, opened: 3, clicked: 4,
  bounced: 5, complained: 5,
};
function rankStatus(s?: string): number {
  return LIVE_STATUS_RANK[(s ?? "").toLowerCase()] ?? 0;
}
/** Whether next status may be applied over current (no regression). Equal rank is allowed (timestamp refresh). */
export function shouldApplyLiveStatus(current: string | undefined, next: string): boolean {
  return rankStatus(next) >= rankStatus(current);
}

/** Persist a live status received via webhook/lookup to the matching record by resendId (no order regression). */
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

/** Set the abort-request flag for a send. The send loop detects it on the next iteration and stops. */
export async function requestAbort(sendId: string): Promise<SendRecord | null> {
  return updateSend(sendId, (r) =>
    r.status === "running" ? { ...r, abortRequested: true } : r
  ).catch(() => null);
}
