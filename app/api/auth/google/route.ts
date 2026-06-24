import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, OAUTH_STATE_COOKIE, originFromRequest } from "@/lib/google";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Redirect to the Google auth screen. Store state(nonce) + next in a cookie.
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") || "/";
  const nonce = crypto.randomUUID();
  const redirectUri = `${originFromRequest(req)}/api/auth/google/callback`;

  const res = NextResponse.redirect(buildAuthUrl(redirectUri, nonce));
  res.cookies.set(OAUTH_STATE_COOKIE, `${nonce}|${next}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  return res;
}
