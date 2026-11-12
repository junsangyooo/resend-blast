import { NextRequest, NextResponse } from "next/server";
import { requireUserEmail } from "@/lib/auth";
import { isAdminAsync } from "@/lib/admins";
import { aiStatus, saveApiKey, clearApiKey, looksLikeApiKey, pingAi, AiCallError, AI_ERROR } from "@/lib/ai/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Settings → AI. Admin only. The key is write-only: GET returns a 4-char hint, never the key. */
async function guard(): Promise<{ email: string } | NextResponse> {
  try {
    const email = await requireUserEmail();
    if (!(await isAdminAsync(email))) return NextResponse.json({ error: "관리자 권한 필요" }, { status: 403 });
    return { email };
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
}

export async function GET() {
  const g = await guard();
  if (g instanceof NextResponse) return g;
  return NextResponse.json(await aiStatus());
}

/** Register / replace the API key. */
export async function PUT(req: NextRequest) {
  const g = await guard();
  if (g instanceof NextResponse) return g;
  const body = await req.json().catch(() => ({}));
  const key = String(body?.apiKey ?? "").trim();
  if (!looksLikeApiKey(key)) return NextResponse.json({ error: "키 형식 오류 · sk-ant- 로 시작하는 키" }, { status: 400 });
  await saveApiKey(key, g.email);
  return NextResponse.json(await aiStatus());
}

/** Remove the registered key (falls back to .env.local key or the CLI login). */
export async function DELETE() {
  const g = await guard();
  if (g instanceof NextResponse) return g;
  await clearApiKey();
  return NextResponse.json(await aiStatus());
}

/** Connection test: one tiny real call with the credential that would be used now. */
export async function POST() {
  const g = await guard();
  if (g instanceof NextResponse) return g;
  try {
    const r = await pingAi();
    return NextResponse.json({ ok: true, source: r.source, ms: r.ms });
  } catch (e) {
    console.error("[ai/settings test]", e);
    const message = e instanceof AiCallError ? e.userMessage : AI_ERROR.generic;
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
