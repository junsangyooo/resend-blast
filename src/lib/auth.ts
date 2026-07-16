/**
 * Session helpers for route handlers.
 * Middleware already blocks 401s, but use these when a user ID is needed (e.g., creator/audit logs).
 */
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "./session";

export type SessionUser = { email: string; name?: string; picture?: string };

/** Session user info (email + display profile). */
export async function currentUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const payload = await verifySession(token);
  if (!payload?.email) return null;
  return { email: payload.email, name: payload.name, picture: payload.picture };
}

export async function currentUserEmail(): Promise<string | null> {
  return (await currentUser())?.email ?? null;
}

export async function requireUserEmail(): Promise<string> {
  const email = await currentUserEmail();
  if (!email) throw new Error("unauthenticated");
  return email;
}
