import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, verifyDomain, OAUTH_STATE_COOKIE, originFromRequest } from "@/lib/google";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fail(req: NextRequest, reason: string) {
  const dest = new URL("/login", originFromRequest(req));
  dest.search = `?error=${encodeURIComponent(reason)}`;
  return NextResponse.redirect(dest);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookie = req.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || !cookie) return fail(req, "auth");
  const [nonce, next = "/"] = cookie.split("|");
  if (state !== nonce) return fail(req, "state");

  try {
    const redirectUri = `${originFromRequest(req)}/api/auth/google/callback`;
    const info = await exchangeCode(code, redirectUri);
    const email = verifyDomain(info);
    if (!email) return fail(req, "domain"); // domain not allowed

    const token = await createSession(email);
    // Prevent open redirect: only allow paths starting with a single non-slash slash ( blocks "//evil.com" )
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    const dest = new URL(safeNext, originFromRequest(req));

    const res = NextResponse.redirect(dest);
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  } catch (e) {
    return fail(req, "exchange");
  }
}
