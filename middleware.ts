import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { originFromRequest } from "@/lib/google";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    // 공개 라우트: webhook(서명검증), 수신거부(토큰검증), 헬스체크 — 세션 불필요.
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/unsubscribe") ||
    pathname.startsWith("/api/resubscribe") ||
    pathname === "/api/health" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dest = new URL("/login", originFromRequest(req));
  dest.searchParams.set("next", pathname);
  return NextResponse.redirect(dest);
}

export const config = {
  // _next 정적, favicon, public/ 의 흔한 정적 자산은 인증 검사를 건너뛴다.
  // robots.txt, OG 이미지 등을 public/ 에 두면 크롤러·SNS 카드 미리보기가 가능해야 한다.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|icon|apple-icon|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff2?|ttf|txt|xml|map)$).*)",
  ],
};
