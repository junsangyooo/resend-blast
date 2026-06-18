/**
 * 트랜잭션 메일(수신거부 확인 등) — /api/send 경로를 거치지 않고 Resend 로 직접 발송.
 * 억제목록 필터/레이트리밋과 무관(확인 메일은 본인 행동에 대한 즉시 응답).
 */
import { Resend } from "resend";
import { FROM_DEFAULT, SENDER_ORG_NAME } from "./config";
import { brand } from "../brand.config";

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 수신거부 완료 확인 메일 — 재구독(Resubscribe) 버튼 포함.
 * 실패해도 throw 하지 않음(수신거부 자체는 이미 처리됨). 발송 성공 여부 boolean 반환.
 */
export async function sendUnsubscribeConfirmation(toEmail: string, resubUrl: string): Promise<boolean> {
  const key = process.env.RESEND_EMAIL_TRACKING_API_KEY;
  if (!key) return false;
  const org = esc(SENDER_ORG_NAME);
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"></head>
  <body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Noto Sans KR',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f5f5f5;"><tr><td align="center" style="padding:40px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;">
        <tr><td style="background-color:#ffffff;border:1px solid #e5e5e5;border-radius:8px;padding:40px;text-align:center;">
          <h1 style="color:#0a0a0a;font-size:22px;font-weight:700;margin:0 0 16px;">수신거부가 완료되었습니다</h1>
          <p style="color:#4a4a4a;font-size:15px;line-height:1.7;margin:0 0 8px;">앞으로 ${org} 의 메일을 받지 않으시도록 처리했습니다.</p>
          <p style="color:#6a6a6a;font-size:13px;line-height:1.7;margin:0 0 28px;">You have been unsubscribed and will no longer receive these emails.</p>
          <p style="color:#6a6a6a;font-size:13px;line-height:1.7;margin:0 0 14px;">실수로 누르셨나요? 아래 버튼으로 다시 구독할 수 있습니다.</p>
          <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;"><tr>
            <td align="center" bgcolor="${brand.email.colors.mint}" style="background-color:${brand.email.colors.mint};border-radius:8px;">
              <a href="${esc(resubUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 32px;color:${brand.email.colors.ink};font-size:14px;font-weight:700;text-decoration:none;">다시 구독하기 (Resubscribe) &rarr;</a>
            </td>
          </tr></table>
          <p style="color:#aaaaaa;font-size:11px;line-height:1.6;margin:28px 0 0;">&copy; ${new Date().getFullYear()} ${org}</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  try {
    const resend = new Resend(key);
    const { error } = await resend.emails.send({
      from: FROM_DEFAULT,
      to: toEmail,
      subject: "수신거부 완료 / Unsubscribed",
      html,
    });
    return !error;
  } catch {
    return false;
  }
}
