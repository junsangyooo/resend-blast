import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, OAUTH_STATE_COOKIE, originFromRequest } from "@/lib/google";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 구글 인증 화면으로 redirect. state(nonce) + next 를 쿠키에 저장.
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") || "/";
  const nonce = crypto.randomUUID();
  const redirectUri = `${originFromRequest(req)}/api/auth/google/callback`;

  const res = NextResponse.redirect(buildAuthUrl(redirectUri, nonce));
  res.cookies.set(OAUTH_STATE_COOKIE, `${nonce}|${next}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10분
    path: "/",
  });
  return res;
}
