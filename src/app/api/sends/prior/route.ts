import { NextRequest, NextResponse } from "next/server";
import { buildFullHtml } from "@/lib/templates";
import { listRecords } from "@/lib/send-log";
import { contentFingerprint } from "@/lib/send-guards";
import { classifyPrior } from "@/lib/prior";
import { requireUserEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Who among `emails` already received (or is scheduled to receive) this email. */
export async function POST(req: NextRequest) {
  try {
    await requireUserEmail();
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { template, emails } = await req.json().catch(() => ({}));
  const name = String(template ?? "");
  const built = await buildFullHtml(name);
  if (!built) return NextResponse.json({ error: "이메일 없음" }, { status: 404 });
  const list: string[] = Array.isArray(emails) ? emails.filter((e: unknown) => typeof e === "string").slice(0, 5000) : [];
  const records = await listRecords((r) => r.templateName === name && r.kind !== "test");
  const hits = classifyPrior(records, {
    templateName: name,
    currentHash: contentFingerprint(built.html, built.subject),
    templateModifiedAt: built.lastModifiedAt,
    emails: list,
  });
  return NextResponse.json({ hits });
}
