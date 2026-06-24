import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { originFromRequest } from "@/lib/google";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    // Public routes: webhook (signature-verified), unsubscribe (token-verified), health check — no session needed.
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/unsubscribe") ||
    pathname.startsWith("/api/resubscribe") ||
    // Local images inside emails (hosted mode) — mail clients must load them without a session.
    pathname.startsWith("/api/assets/") ||
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
  // Skip auth checks for _next static, favicon, and common static assets in public/.
  // robots.txt, OG images, etc. placed in public/ must be accessible to crawlers/SNS card previews.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|icon|apple-icon|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff2?|ttf|txt|xml|map)$).*)",
  ],
};
