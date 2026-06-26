import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Lightweight health check for external monitors (UptimeRobot etc.). No auth required (middleware bypass). */
export async function GET() {
  return NextResponse.json({ ok: true, service: "email-blast", time: new Date().toISOString() });
}
