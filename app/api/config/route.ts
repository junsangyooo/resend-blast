import { NextResponse } from "next/server";
import { FROM_DEFAULT, REPLY_TO_DEFAULT, MAX_RECIPIENTS_PER_SEND } from "@/lib/config";
import { listSenders, myAccountOption, addressOf } from "@/lib/senders";
import { isAdminAsync } from "@/lib/admins";
import { currentUserEmail } from "@/lib/auth";
import { brand } from "@/brand.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** UI에서 사용하는 운영 상수: 발신자 목록(내장+공용+본인 personal+내 계정), 현재 사용자, 관리자 여부, 발송 상한. */
export async function GET() {
  const me = await currentUserEmail();
  const meLower = me?.toLowerCase() ?? null;
  const senders = await listSenders(meLower);
  // 본인 주소의 personal 닉네임이 없으면 "내 계정" 가상 옵션 합성 — 저장 없이 항상 본인 계정으로 발송 가능.
  // 단 password 모드에선 운영자 신원(operatorEmail)이 senderDomain 밖(예: gmail)이라
  // 발송 시 차단될 주소다 → 합성하지 않는다(내장 발신자만 사용).
  if (brand.auth.mode !== "password" && meLower && !senders.some((o) => o.scope === "personal" && addressOf(o.value) === meLower)) {
    senders.push(myAccountOption(meLower));
  }
  return NextResponse.json({
    fromOptions: senders,
    fromDefault: FROM_DEFAULT,
    replyToDefault: REPLY_TO_DEFAULT,
    maxRecipients: MAX_RECIPIENTS_PER_SEND,
    me,
    isAdmin: await isAdminAsync(me),
  });
}
