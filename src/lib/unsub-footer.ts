/**
 * Fixed, design-independent unsubscribe line for ad mails whose body has no %%UNSUB_URL%%.
 * Appended after the email content (outside the email's own layout) so it never touches the design.
 * Shared by the send pipeline and the confirm-modal preview, so preview == actual send.
 */
import { UNSUB_PLACEHOLDER } from "./personalize";

export function hasUnsubLink(html: string): boolean {
  return html.includes(UNSUB_PLACEHOLDER);
}

export const UNSUB_FOOTER_HTML =
  `<div data-eb-unsub-footer="1" style="max-width:600px;margin:0 auto;padding:16px 20px 28px;text-align:center;` +
  `font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;` +
  `font-size:12px;line-height:1.7;color:#8a8a8a;">` +
  `본 메일은 광고성 정보입니다. 더 이상 받지 않으시려면 ` +
  `<a href="${UNSUB_PLACEHOLDER}" style="color:#8a8a8a;text-decoration:underline;">수신거부</a>를 눌러 주세요.<br>` +
  `To stop receiving these emails, <a href="${UNSUB_PLACEHOLDER}" style="color:#8a8a8a;text-decoration:underline;">unsubscribe</a>.` +
  `</div>`;

/** Returns html unchanged if it already has an unsubscribe link; otherwise appends the fixed line. */
export function ensureUnsubFooter(html: string): string {
  if (hasUnsubLink(html)) return html;
  const idx = html.toLowerCase().lastIndexOf("</body>");
  if (idx < 0) return html + UNSUB_FOOTER_HTML;
  return html.slice(0, idx) + UNSUB_FOOTER_HTML + html.slice(idx);
}
