import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { applyLiveStatus, invalidateResendIdIndex, buildResendIdIndex } from "@/lib/send-log";
import { suppress } from "@/lib/suppression";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Resend webhook 수신. open/click/bounce/complaint 등을 send 레코드에 영속(라이브 상태 30일 유실 대비)하고,
 * bounced/complained 주소는 억제목록에 추가해 다음 발송에서 자동 제외.
 * 서명: Svix 표준(svix-id/svix-timestamp/svix-signature, secret=whsec_...). 미설정 시 비활성(503).
 * 미들웨어 bypass 경로(세션 불필요) — 서명으로 진위 검증.
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

  let evt: any;
  try { evt = JSON.parse(body); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const type: string = evt?.type ?? "";
  const status = EVENT_TO_STATUS[type];
  const data = evt?.data ?? {};
  const emailId: string = data.email_id ?? data.id ?? "";

  if (status && emailId) {
    invalidateResendIdIndex();
    await applyLiveStatus(emailId, status);
  }

  // 반송/스팸신고 → 억제목록 (다음 발송에서 자동 제외)
  if (type === "email.bounced" || type === "email.complained") {
    const reason = type === "email.bounced" ? "bounced" : "complained";
    const tos: string[] = Array.isArray(data.to) ? data.to : data.to ? [data.to] : [];
    // Resend 반송 페이로드는 data.to 가 비어있는 경우가 있다 → resendId 로 수신자를 역추적해
    // 반드시 억제한다(없으면 다음 발송에서 하드바운스 주소로 재발송되어 평판 악화).
    if (tos.length === 0 && emailId) {
      const idx = await buildResendIdIndex();
      const hit = idx.get(emailId);
      if (hit?.email) tos.push(hit.email);
    }
    for (const to of tos) await suppress(to, reason as any, "resend-webhook");
  }

  return NextResponse.json({ ok: true });
}
