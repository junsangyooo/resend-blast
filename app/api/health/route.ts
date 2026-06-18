import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 외부 모니터(UptimeRobot 등)용 경량 헬스체크. 인증 불필요(미들웨어 bypass). */
export async function GET() {
  return NextResponse.json({ ok: true, service: "email-blast", time: new Date().toISOString() });
}
