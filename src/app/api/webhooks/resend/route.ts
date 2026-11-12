import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { applyLiveStatus, buildResendIdIndex } from "@/lib/send-log";
import { suppress } from "@/lib/suppression";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Receives Resend webhooks. Persists open/click/bounce/complaint etc. into the send record (guards against the 30-day loss of live status),
 * and adds bounced/complained addresses to the suppression list so they are excluded from the next send automatically.
 * Signature: Svix standard (svix-id/svix-timestamp/svix-signature, secret=whsec_...). Disabled (503) if not configured.
 * Middleware-bypass path (no session needed) — authenticity is verified by the signature.
 */
const EVENT_TO_STATUS: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

function verifySvix(secret: string, svixId: string, svixTs: string, body: string, sigHeader: string): boolean {
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const signed = `${svixId}.${svixTs}.${body}`;
    const expected = crypto.createHmac("sha256", key).update(signed).digest("base64");
    // svix-signature: "v1,<sig> v1,<sig2> ..."
    const expBuf = Buffer.from(expected);
    return sigHeader.split(" ").some((part) => {
      const sig = part.includes(",") ? part.split(",")[1] : part;
      const b = Buffer.from(sig);
      return b.length === expBuf.length && crypto.timingSafeEqual(b, expBuf);
    });
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook 미설정" }, { status: 503 });

  const body = await req.text();
  const svixId = req.headers.get("svix-id") ?? "";
  const svixTs = req.headers.get("svix-timestamp") ?? "";
  const svixSig = req.headers.get("svix-signature") ?? "";
  if (!svixId || !svixTs || !svixSig || !verifySvix(secret, svixId, svixTs, body, svixSig)) {
    return NextResponse.json({ error: "서명 검증 실패" }, { status: 401 });
  }
  // Replay protection (Svix standard: reject timestamps more than 5 minutes off).
  const tsSec = Number(svixTs);
  if (!Number.isFinite(tsSec) || Math.abs(Date.now() / 1000 - tsSec) > 5 * 60) {
    return NextResponse.json({ error: "오래된 요청" }, { status: 401 });
  }

  let evt: any;
  try { evt = JSON.parse(body); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const type: string = evt?.type ?? "";
  const status = EVENT_TO_STATUS[type];
  const data = evt?.data ?? {};
  const emailId: string = data.email_id ?? data.id ?? "";

  if (status && emailId) {
    // applyLiveStatus rebuilds the id index only on a miss (no full rescan per event).
    await applyLiveStatus(emailId, status);
  }

  // bounce/spam complaint → suppression list (excluded automatically from the next send)
  // A bounce explicitly marked transient (mailbox full, temporary failure) is not a reason to block the address forever.
  const bounceType = String(data?.bounce?.type ?? "").toLowerCase();
  const transient = type === "email.bounced" && (bounceType === "transient" || bounceType === "temporary");
  if ((type === "email.bounced" && !transient) || type === "email.complained") {
    const reason = type === "email.bounced" ? "bounced" : "complained";
    const tos: string[] = Array.isArray(data.to) ? data.to : data.to ? [data.to] : [];
    // Resend bounce payloads sometimes have an empty data.to → trace the recipient back via resendId
    // and always suppress it (otherwise the next send re-sends to a hard-bounce address and hurts reputation).
    if (tos.length === 0 && emailId) {
      const idx = await buildResendIdIndex();
      const hit = idx.get(emailId);
      if (hit?.email) tos.push(hit.email);
    }
    for (const to of tos) await suppress(to, reason as any, "resend-webhook");
  }

  return NextResponse.json({ ok: true });
}
