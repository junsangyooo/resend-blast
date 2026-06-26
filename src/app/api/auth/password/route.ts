import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import { brand } from "@/brand.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Constant-time comparison (mitigates timing attacks). Length mismatch returns false immediately. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * password mode login — verifies a single password (ACCESS_PASSWORD in .env.local), then
 * issues a session under the brand.auth.operatorEmail identity. Does not work in google mode.
 */
export async function POST(req: NextRequest) {
  if (brand.auth.mode !== "password") {
    return NextResponse.json({ error: "password 모드가 아닙니다." }, { status: 404 });
  }
  const expected = process.env.ACCESS_PASSWORD;
  if (!expected) {
    // Password not configured — never allow silently (prevents an everyone-passes accident).
    return NextResponse.json(
      { error: "서버에 ACCESS_PASSWORD 가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  let password = "";
  try {
    const body = await req.json();
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (!password || !safeEqual(password, expected)) {
    return NextResponse.json({ error: brand.ui.login.passwordError }, { status: 401 });
  }

  const token = await createSession(brand.auth.operatorEmail);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
