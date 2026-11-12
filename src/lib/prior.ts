/**
 * "Already received" classification — pure, shared by the API and tests.
 *
 * For one email (template) and a set of recipient addresses, find who already got it:
 *  - same      : received this email and the content has not changed since
 *  - modified  : received an earlier version (email edited after that send)
 *  - scheduled : not received yet, but is in a pending scheduled send of this email
 * A brand-new email (never sent) yields no hits, so no warning is shown.
 */

export type PriorKind = "same" | "modified" | "scheduled";
export type PriorHit = { email: string; kind: PriorKind; sendId: string; at: string };

export type PriorRecord = {
  id: string;
  createdAt: string;
  status: string;
  kind?: string;
  templateName: string;
  htmlHash?: string;
  scheduledAt?: string;
  recipients: { email: string; status: string; sentAt?: string }[];
};

const RANK: Record<PriorKind, number> = { same: 3, modified: 2, scheduled: 1 };

export function classifyPrior(
  records: PriorRecord[],
  opts: { templateName: string; currentHash: string; templateModifiedAt?: string; emails: string[] },
): PriorHit[] {
  const wanted = new Set(opts.emails.map((e) => e.toLowerCase().trim()));
  const best = new Map<string, PriorHit>();
  const consider = (hit: PriorHit) => {
    const cur = best.get(hit.email);
    if (!cur || RANK[hit.kind] > RANK[cur.kind] || (RANK[hit.kind] === RANK[cur.kind] && hit.at > cur.at)) {
      best.set(hit.email, hit);
    }
  };

  for (const rec of records) {
    if (rec.templateName !== opts.templateName || rec.kind === "test") continue;
    if (rec.status === "scheduled") {
      for (const r of rec.recipients ?? []) {
        const e = r.email.toLowerCase();
        if (wanted.has(e) && r.status === "pending") {
          consider({ email: e, kind: "scheduled", sendId: rec.id, at: rec.scheduledAt ?? rec.createdAt });
        }
      }
      continue;
    }
    if (!["running", "completed", "aborted"].includes(rec.status)) continue;
    const same = rec.htmlHash
      ? rec.htmlHash === opts.currentHash
      // Legacy records have no content hash: treat as unchanged unless the email was saved after that send.
      : !opts.templateModifiedAt || rec.createdAt >= opts.templateModifiedAt;
    for (const r of rec.recipients ?? []) {
      const e = r.email.toLowerCase();
      if (!wanted.has(e) || r.status !== "sent") continue;
      consider({ email: e, kind: same ? "same" : "modified", sendId: rec.id, at: r.sentAt ?? rec.createdAt });
    }
  }
  return Array.from(best.values()).sort((a, b) => a.email.localeCompare(b.email));
}
