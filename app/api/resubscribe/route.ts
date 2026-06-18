import { NextRequest, NextResponse } from "next/server";
import { verifyUnsubToken } from "@/lib/unsubscribe";
import { unsuppress, isSuppressed } from "@/lib/suppression";
import { brand } from "@/brand.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 재구독 (공개 — 미들웨어 bypass, 토큰 서명 검증). 수신거부 확인 메일의 "다시 구독하기" 버튼이 향한다.
 * - GET  : 확인 페이지(POST 버튼). GET 자체로는 해제하지 않음.
 * - POST : 억제목록에서 제거.
 * 재구독 후엔 추가 메일을 보내지 않는다(메일 루프 방지).
 */
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function page(title: string, msg: string, opts?: { token?: string; email?: string }): string {
  const form = opts?.token
    ? `<form method="POST" action="/api/resubscribe?token=${encodeURIComponent(opts.token)}" style="margin-top:20px">
         <button type="submit" style="background:${brand.email.colors.mint};color:${brand.email.colors.ink};border:0;border-radius:8px;padding:12px 28px;font-size:15px;font-weight:700;cursor:pointer">다시 구독하기</button>
       </form>`
    : "";
  const who = opts?.email ? `<p style="color:#6a6a6a;font-size:13px">${esc(opts.email)}</p>` : "";
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head>
  <body style="margin:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif">
    <div style="max-width:440px;margin:80px auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:36px;text-align:center">
      <h1 style="font-size:20px;color:#0a0a0a;margin:0 0 12px">${esc(title)}</h1>
      <p style="color:#4a4a4a;font-size:14px;line-height:1.7;margin:0">${esc(msg)}</p>
      ${who}${form}
      <p style="color:#aaa;font-size:11px;margin-top:28px">${esc(brand.ui.footerWordmark)}</p>
    </div>
  </body></html>`;
}
function html(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const v = verifyUnsubToken(token, "resub");
  if (!v) return html(page("링크가 유효하지 않습니다", "재구독 링크가 올바르지 않습니다."), 400);
  if (!(await isSuppressed(v.email))) {
    return html(page("이미 구독 중입니다", "이 주소는 이미 메일을 받고 있습니다.", { email: v.email }));
  }
  return html(page("다시 구독", "아래 버튼을 누르면 다시 메일을 받게 됩니다.", { token, email: v.email }));
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const v = verifyUnsubToken(token, "resub");
  if (!v) return NextResponse.json({ ok: false }, { status: 400 });
  await unsuppress(v.email);
  const accepts = req.headers.get("accept") ?? "";
  if (accepts.includes("text/html")) {
    return html(page("재구독 완료", "다시 메일을 받게 됩니다. 감사합니다.", { email: v.email }));
  }
  return NextResponse.json({ ok: true });
}
