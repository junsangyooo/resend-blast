import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  // 설정 시와 동일한 path 로 삭제해야 일부 런타임에서 쿠키가 확실히 제거된다(세션 잔존 방지).
  cookies().delete({ name: SESSION_COOKIE, path: "/" });
  return NextResponse.json({ ok: true });
}
