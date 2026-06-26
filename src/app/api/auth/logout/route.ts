import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  // Must delete with the same path used when setting, so some runtimes reliably remove the cookie (prevents lingering sessions).
  cookies().delete({ name: SESSION_COOKIE, path: "/" });
  return NextResponse.json({ ok: true });
}
