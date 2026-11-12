/**
 * Send log — one file per send.
 * Storage: data/sends/{id}.json
 * No conflicts between concurrent sends (each send gets a fresh file).
 * Recorded as partial while sending → updated to final on completion.
 */
import fs from "fs/promises";
import path from "path";
import { customAlphabet } from "nanoid";
import { atomicWrite, withFileLock, readJsonSafe } from "./atomic";
import { SEND_MIN_GAP_MS } from "./config";
import { PROBLEM } from "./status-text";

const SENDS_DIR = path.join(process.cwd(), "data", "sends");

const idGen = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);
const ID_RE = /^[0-9a-zA-Z._-]+$/;

/**
 * running/completed/aborted: executed sends.
 * scheduled → (running → completed|aborted) | canceled | missed (server was off at that time) | failed (could not start).
 */
export type SendStatus = "scheduled" | "running" | "completed" | "aborted" | "canceled" | "missed" | "failed";
export const EXECUTED_STATUSES: SendStatus[] = ["running", "completed", "aborted"];

export type SendRecipient = {
  email: string;
  name?: string;
  company?: string;
  title?: string;
  listSlug?: string | null;
  resendId?: string;
  /** skipped = intentionally not sent (unsubscribed mid-send, over the send limit, removed). */
  status: "pending" | "sent" | "failed" | "skipped";
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
  summary: { total: number; sent: number; failed: number; skipped?: number };
  /** Content fingerprint — for duplicate-send (idempotency) checks. */
  hash?: string;
  /** Abort-request flag while sending — checked by the send loop on every iteration. */
  abortRequested?: boolean;
  /** Whether this is a promotional send ((광고) subject prefix + mandatory unsubscribe). */
  isAd?: boolean;
  /** Send kind. test is for the sender's own review, followup is a re-send. */
  kind?: "normal" | "test" | "followup";
  /** Original send id for a follow-up (re-send). */
  sourceSendId?: string;
  /** Number of recipients excluded by the suppression list. */
  excludedSuppressed?: number;
  /** Display name of the email at send time (templateName is the internal id). */
  templateTitle?: string;
  /** sha256 of the built (token-preserving) html + subject — "already received / modified" detection. */
  htmlHash?: string;
  /** Lists whose members were excluded from this send. */
  excludeListSlugs?: string[];
  /** Addresses the sender chose to exclude (e.g. already received). */
  excludedEmails?: string[];
  /** Scheduled sends: target time (UTC ISO). */
  scheduledAt?: string;
  /** When execution actually began (scheduled sends start long after createdAt). */
  startedAt?: string;
  /** Scheduled sends: content frozen at scheduling time. Removed after execution to keep files small. */
  snapshot?: { html: string; subject: string; hasUnsub: boolean };
  /** Why a scheduled send did not (fully) run — shown in the schedule tab. */
  problem?: string;
  problemAcknowledged?: boolean;
  canceledBy?: string;
  canceledAt?: string;
};

/** Current stage of one recipient (mutually exclusive). liveStatus first, else send status. */
export type StatusStage = "delivered" | "sent" | "bounced" | "failed" | "pending";
export function recipientStage(r: Pick<SendRecipient, "status" | "liveStatus">): StatusStage {
  if (r.status === "failed" || r.status === "skipped") return "failed";
  if (r.status === "pending") return "pending";
  const ls = (r.liveStatus ?? "").toLowerCase();
  if (ls === "bounced" || ls === "complained") return "bounced";
  if (ls === "delivered" || ls === "opened" || ls === "clicked") return "delivered";
  return "sent"; // sent, but delivery not yet confirmed
}
export type StatusBreakdown = { delivered: number; sent: number; bounced: number; failed: number; pending: number };
export function statusBreakdown(recipients: SendRecipient[]): StatusBreakdown {
  const b: StatusBreakdown = { delivered: 0, sent: 0, bounced: 0, failed: 0, pending: 0 };
  for (const r of recipients ?? []) b[recipientStage(r)]++;
  return b;
}

export type SendSummary = Omit<SendRecord, "recipients"> & { recipientCount: number; statusBreakdown: StatusBreakdown };

export function newSendId(): string {
  // ISO timestamp + 6char nanoid → sorts by time and is unique
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
    const { recipients, snapshot: _snapshot, ...rest } = data;
    out.push({ ...rest, recipientCount: recipients?.length ?? 0, statusBreakdown: statusBreakdown(recipients) });
  }
  return out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/** Full records (with recipients). Used by the scheduler and the "already received" check. */
export async function listRecords(filter?: (r: SendRecord) => boolean): Promise<SendRecord[]> {
  await ensureDir();
  const files = await fs.readdir(SENDS_DIR);
  const out: SendRecord[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const id = f.replace(/\.json$/, "");
    if (!ID_RE.test(id)) continue;
    const data = await readJsonSafe<SendRecord | null>(path.join(SENDS_DIR, f), null);
    if (data && (!filter || filter(data))) out.push(data);
  }
  return out;
}

/**
 * If the server dies or a deploy restart interrupts a send, a record can be stuck in `running` forever.
 * Mark running records as aborted, with a cutoff that is **dynamic, proportional to recipient count**,
 * so a genuinely in-progress bulk send is not mismarked even if it runs past an hour.
 * e.g. 5000 recipients × 220ms ≈ 18.3 min → cutoff = twice that + 30 min margin.
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
    if (data.finishedAt) continue; // already finished (only status is missing)
    // Scheduled sends are created long before they run — measure from the actual start.
    const created = new Date(data.startedAt ?? data.scheduledAt ?? data.createdAt).getTime();
    if (!Number.isFinite(created)) continue;
    // If there is recent progress (last sentAt within 10 min), the send is genuinely alive → leave it alone.
    // (So a slow/retrying/contended send that exceeds the estimate is not misjudged and overwritten as aborted.)
    const progressed = (data.summary?.sent ?? 0) + (data.summary?.failed ?? 0);
    if (progressed > 0) {
      const lastSentAt = (data.recipients ?? [])
        .map((r) => (r.sentAt ? new Date(r.sentAt).getTime() : 0))
        .reduce((a, b) => Math.max(a, b), 0);
      const idleMs = now - (lastSentAt || created);
      if (idleMs < 10 * 60 * 1000) continue; // activity within 10 min → in progress
    }
    // Dynamic cutoff: 2× expected duration (recipients × gap × 3× retry allowance) + 30 min, at least minAgeMs.
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
      // on a concurrent modification, retry next cycle
    }
  }
  return fixed;
}

/**
 * Boot-time cleanup: this process just started, so nothing can be running — any "running" record was cut off
 * by a restart (deploy, crash). Mark it aborted right away (pending recipients stay pending for "이어 보내기")
 * and, for scheduled sends, leave a visible problem in the schedule tab.
 */
export async function abortOrphanedSends(): Promise<number> {
  const orphans = await listRecords((r) => r.status === "running");
  let n = 0;
  for (const o of orphans) {
    await updateSend(o.id, (r) => {
      if (r.status !== "running") return r;
      n++;
      const left = r.recipients.filter((x) => x.status === "pending").length;
      return {
        ...r,
        status: "aborted",
        finishedAt: r.finishedAt ?? new Date().toISOString(),
        abortRequested: undefined,
        ...(r.scheduledAt ? { problem: PROBLEM.restartAborted(left), problemAcknowledged: false } : {}),
      };
    }).catch(() => null);
  }
  return n;
}

/**
 * Mapping from every send's resend id → metadata. Used for tracking-status lookup.
 * Short TTL cache since the sidebar polls every 15s. Even if updateSend adds a new
 * resendId to an in-progress send, it shows up by the next poll (at most INDEX_CACHE_TTL_MS).
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

/** Invalidate the cache — when an in-progress send added a new resendId or a change must show immediately after a webhook. */
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

/** Aggregate by live status from the record's recipients. liveStatus first, else send status. */
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

/** Number of send attempts by the user within the recent window (ms) (rate limit). Attempts = sum of summary.total. Test sends excluded. */
export async function userSendVolume(email: string, windowMs: number, excludeId?: string): Promise<number> {
  await ensureDir();
  const files = await fs.readdir(SENDS_DIR);
  const since = Date.now() - windowMs;
  const target = email.toLowerCase();
  let total = 0;
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const data = await readJsonSafe<SendRecord | null>(path.join(SENDS_DIR, f), null);
    if (!data || data.kind === "test") continue;
    if (excludeId && data.id === excludeId) continue;
    if (!EXECUTED_STATUSES.includes(data.status)) continue;
    if ((data.sentBy ?? "").toLowerCase() !== target) continue;
    // Executed scheduled sends count from when they ran, not when they were booked.
    const t = new Date(data.scheduledAt ?? data.createdAt).getTime();
    if (!Number.isFinite(t) || t < since) continue;
    // running: everything not skipped is reserved; finished: only what was actually attempted.
    total += data.status === "running"
      ? (data.recipients ?? []).filter((r) => r.status !== "skipped").length
      : (data.summary?.sent ?? 0) + (data.summary?.failed ?? 0);
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
    // Only a send that is in flight or actually delivered something counts as a duplicate —
    // a send where every recipient failed (e.g. provider outage) must be retryable right away.
    if (data.status !== "running" && data.status !== "scheduled" && (data.summary?.sent ?? 0) === 0) continue;
    const t = new Date(data.createdAt).getTime();
    if (!Number.isFinite(t) || t < since) continue;
    if (!best || (data.createdAt ?? "") > (best.createdAt ?? "")) best = data;
  }
  return best;
}

/**
 * Live-status progression rank. Webhooks have no ordering guarantee (e.g. delivered arrives after opened),
 * so a more advanced status must not be reverted to an earlier one. bounced/complained are terminal (highest).
 */
const LIVE_STATUS_RANK: Record<string, number> = {
  sent: 1, queued: 1, delivery_delayed: 1,
  delivered: 2, opened: 3, clicked: 4,
  bounced: 5, complained: 5,
};
function rankStatus(s?: string): number {
  return LIVE_STATUS_RANK[(s ?? "").toLowerCase()] ?? 0;
}
/** Whether next may be applied over current (no regression). Equal rank is allowed (timestamp refresh). */
export function shouldApplyLiveStatus(current: string | undefined, next: string): boolean {
  return rankStatus(next) >= rankStatus(current);
}

/** Persist a live status received via webhook/lookup into the matching record by resendId (prevents order regression). */
export async function applyLiveStatus(resendId: string, status: string): Promise<boolean> {
  let hit = (await buildResendIdIndex()).get(resendId);
  if (!hit) {
    // A send that started after the cached index was built — rebuild once (cheap path stays cached).
    invalidateResendIdIndex();
    hit = (await buildResendIdIndex()).get(resendId);
  }
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

/** Set the abort-request flag. The send loop detects it on its next iteration and stops. */
export async function requestAbort(sendId: string): Promise<SendRecord | null> {
  return updateSend(sendId, (r) =>
    r.status === "running" ? { ...r, abortRequested: true } : r
  ).catch(() => null);
}

