import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import { brand } from "@/brand.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 상수시간 비교 (타이밍 공격 완화). 길이 불일치는 즉시 false. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * password 모드 로그인 — 단일 비밀번호(.env.local 의 ACCESS_PASSWORD) 검증 후
 * brand.auth.operatorEmail 신원으로 세션 발급. google 모드에서는 동작하지 않는다.
 */
export async function POST(req: NextRequest) {
  if (brand.auth.mode !== "password") {
    return NextResponse.json({ error: "password 모드가 아닙니다." }, { status: 404 });
  }
  const expected = process.env.ACCESS_PASSWORD;
  if (!expected) {
    // 비밀번호 미설정 — silent 허용 금지(누구나 통과 사고 방지).
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
