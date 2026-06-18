import { NextRequest, NextResponse } from "next/server";
import { listTemplates, saveTemplate, buildFullHtml, setArchived, deleteTemplate } from "@/lib/templates";
import { previewFill } from "@/lib/blocks";
import { requireUserEmail } from "@/lib/auth";

export async function GET(req: NextRequest) {
  // 발송 확인 모달용: 개인화 토큰을 보존한 풀 HTML(JSON). 클라이언트가 수신자별로 직접 치환해
  // 네트워크 왕복 없이 미리보기를 전환한다. (raw HTML 은 이미 /api/templates/body 로도 노출돼
  // 있어 보안 표면 증가 없음.)
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
    // 저장형 HTML 을 서빙 — sandbox 지시자는 빼서 새 탭에서 링크(target=_blank)가 열리고
    // 외부/same-origin 스크립트(예: 메일 클라이언트 측 이메일 디코딩)가 동작하도록 한다.
    // inline <script> 는 계속 차단('unsafe-inline' 미부여)하여 저장형 XSS 방어선은 유지.
    // 미리보기는 개인화 토큰을 샘플값으로 치환.
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

// 보관함 토글
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

// 영구 삭제 (보관함에서만 호출)
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
