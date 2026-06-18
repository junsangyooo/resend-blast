/**
 * 라우트 핸들러용 세션 헬퍼.
 * 미들웨어가 이미 401을 막아주지만, 생성자/감사 로그 등 사용자 ID가 필요할 때 사용.
 */
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "./session";

export async function currentUserEmail(): Promise<string | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const payload = await verifySession(token);
  return payload?.email ?? null;
}

export async function requireUserEmail(): Promise<string> {
  const email = await currentUserEmail();
  if (!email) throw new Error("unauthenticated");
  return email;
}
