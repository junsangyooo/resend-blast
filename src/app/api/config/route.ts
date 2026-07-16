import { NextResponse } from "next/server";
import { FROM_DEFAULT, REPLY_TO_DEFAULT, MAX_RECIPIENTS_PER_SEND } from "@/lib/config";
import { listSenders, myAccountOption, addressOf } from "@/lib/senders";
import { isAdminAsync } from "@/lib/admins";
import { currentUser } from "@/lib/auth";
import { brand } from "@/brand.config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Operational constants used by the UI: sender list (built-in + shared + own personal + my account), current user (+profile), admin flag, send limit. */
export async function GET() {
  const user = await currentUser();
  const me = user?.email ?? null;
  const meLower = me?.toLowerCase() ?? null;
  const senders = await listSenders(meLower);
  // If there's no personal nickname for one's own address, synthesize a "my account" virtual option — always able to send from one's own account without saving.
  // But in password mode the operator identity (operatorEmail) is outside senderDomain (e.g. gmail),
  // so it would be an address blocked at send time → don't synthesize it (use built-in senders only).
  if (brand.auth.mode !== "password" && meLower && !senders.some((o) => o.scope === "personal" && addressOf(o.value) === meLower)) {
    senders.push(myAccountOption(meLower));
  }
  return NextResponse.json({
    fromOptions: senders,
    fromDefault: FROM_DEFAULT,
    replyToDefault: REPLY_TO_DEFAULT,
    maxRecipients: MAX_RECIPIENTS_PER_SEND,
    me,
    profile: user ? { name: user.name ?? null, picture: user.picture ?? null } : null,
    isAdmin: await isAdminAsync(me),
  });
}
