/**
 * Session helpers for route handlers.
 * Middleware already blocks 401s, but use these when a user ID is needed (e.g., creator/audit logs).
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
