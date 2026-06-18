import { NextRequest, NextResponse } from "next/server";
import { verifyUnsubToken, resubscribeUrl } from "@/lib/unsubscribe";
import { suppress, isSuppressed } from "@/lib/suppression";
import { sendUnsubscribeConfirmation } from "@/lib/transactional";
import { brand } from "@/brand.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 수신거부 (공개 — 미들웨어 bypass, 토큰 서명으로 진위 검증).
 * - GET  : 확인 페이지(POST 버튼). GET 자체로는 억제하지 않음(메일 스캐너의 prefetch 로 인한 오거부 방지).
 * - POST : 실제 억제 처리. Gmail/Yahoo 의 List-Unsubscribe-Post(One-Click) 도 POST 로 도달.
 */
function page(title: string, msg: string, opts?: { token?: string; email?: string }): string {
  const form = opts?.token
    ? `<form method="POST" action="/api/unsubscribe?token=${encodeURIComponent(opts.token)}" style="margin-top:20px">
         <button type="submit" style="background:${brand.email.colors.teal};color:#fff;border:0;border-radius:8px;padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer">수신거부 확인</button>
       </form>`
    : "";
  const who = opts?.email ? `<p style="color:#6a6a6a;font-size:13px">${esc(opts.email)}</p>` : "";
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head>
  <body style="margin:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif">
    <div style="max-width:440px;margin:80px auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:36px;text-align:center">
      <h1 style="font-size:20px;color:#0a0a0a;margin:0 0 12px">${esc(title)}</h1>
      <p style="color:#4a4a4a;font-size:14px;line-height:1.7;margin:0">${esc(msg)}</p>
      ${who}
      ${form}
      <p style="color:#aaa;font-size:11px;margin-top:28px">${esc(brand.ui.footerWordmark)}</p>
    </div>
  </body></html>`;
}
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function html(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const v = verifyUnsubToken(token, "unsub");
  if (!v) return html(page("링크가 유효하지 않습니다", "수신거부 링크가 만료되었거나 올바르지 않습니다. 메일의 링크를 다시 눌러 주세요."), 400);
  return html(page("수신거부", "아래 버튼을 누르면 앞으로 이 발신자의 메일을 받지 않습니다.", { token, email: v.email }));
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const v = verifyUnsubToken(token, "unsub");
  if (!v) {
    // One-Click POST 은 200 을 기대하므로, 토큰 불량이어도 정보 노출 없이 처리 종료.
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  // 이미 억제 상태면 확인 메일 중복 발송 안 함(반복 클릭/스캐너 방지).
  const already = await isSuppressed(v.email);
  await suppress(v.email, "unsubscribe", `send:${v.sendId}`);
  if (!already) {
    // 확인 메일(재구독 버튼 포함) — best-effort, 실패해도 수신거부는 유효.
    await sendUnsubscribeConfirmation(v.email, resubscribeUrl(v.email, v.sendId)).catch(() => {});
  }

  const accepts = req.headers.get("accept") ?? "";
  if (accepts.includes("text/html")) {
    return html(page("수신거부 완료", "앞으로 이 발신자의 메일을 받지 않습니다. 그동안 관심 가져주셔서 감사합니다.", { email: v.email }));
  }
  return NextResponse.json({ ok: true });
}
