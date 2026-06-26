import { NextRequest, NextResponse } from "next/server";
import { listTemplates, saveTemplate, buildFullHtml, setArchived, deleteTemplate } from "@/lib/templates";
import { previewFill } from "@/lib/blocks";
import { requireUserEmail } from "@/lib/auth";

export async function GET(req: NextRequest) {
  // For the send-confirmation modal: full HTML (JSON) with personalization tokens preserved. The client substitutes
  // per recipient itself to switch previews without a network round-trip. (Raw HTML is already exposed via
  // /api/templates/body too, so there's no increase in attack surface.)
  const builtName = req.nextUrl.searchParams.get("built");
  if (builtName) {
    const built = await buildFullHtml(builtName);
    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ subject: built.subject, html: built.html });
  }
  const preview = req.nextUrl.searchParams.get("preview");
  if (preview) {
    const built = await buildFullHtml(preview);
    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Serve the stored HTML — omit the sandbox directive so links (target=_blank) open in a new tab
    // and external/same-origin scripts (e.g. mail-client-side email decoding) work.
    // inline <script> remains blocked (no 'unsafe-inline' granted), keeping the stored-XSS defense line.
    // The preview substitutes personalization tokens with sample values.
    return new NextResponse(previewFill(built.html), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; script-src 'self' https:; frame-ancestors 'self'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  return NextResponse.json({ templates: await listTemplates() });
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireUserEmail();
    const { name, subject, body, description, overwrite } = await req.json();
    await saveTemplate(name, subject, body, description ?? "", actor, { overwrite: !!overwrite });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "save failed";
    const status = msg.includes("권한") ? 403 : msg.includes("이미 같은 이름") ? 409 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

// Archive toggle
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireUserEmail();
    const { name, archived } = await req.json();
    await setArchived(String(name ?? ""), !!archived, actor);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "변경 실패";
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("권한") ? 403 : 400 });
  }
}

// Permanent delete (called only from the archive)
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireUserEmail();
    const name = req.nextUrl.searchParams.get("name");
    await deleteTemplate(String(name ?? ""), actor);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "삭제 실패";
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("권한") ? 403 : 400 });
  }
}
