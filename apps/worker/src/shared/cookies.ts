import type { Env } from "../index.js";

function sessionCookieAttrs(env: Env): string {
  return env.ENVIRONMENT === "production" || env.ENVIRONMENT === "staging"
    ? "HttpOnly; Secure; SameSite=None"
    : "HttpOnly; SameSite=Lax";
}

export function sessionCookie(sessionId: string, maxAge: number, env: Env): string {
  return `fp_session=${sessionId}; ${sessionCookieAttrs(env)}; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(env: Env): string {
  return `fp_session=; ${sessionCookieAttrs(env)}; Path=/; Max-Age=0`;
}
