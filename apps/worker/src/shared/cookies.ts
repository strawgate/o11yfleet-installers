import type { Env } from "../index.js";

function isSecureCookieContext(env: Env, request?: Request): boolean {
  if (env.ENVIRONMENT === "production" || env.ENVIRONMENT === "staging") return true;
  if (!request) return false;

  const url = new URL(request.url);
  return (
    url.protocol === "https:" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
  );
}

function sessionCookieAttrs(env: Env, request?: Request): string {
  return isSecureCookieContext(env, request)
    ? "HttpOnly; Secure; SameSite=None"
    : "HttpOnly; SameSite=Lax";
}

export function sessionCookie(
  sessionId: string,
  maxAge: number,
  env: Env,
  request?: Request,
): string {
  return `fp_session=${sessionId}; ${sessionCookieAttrs(env, request)}; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(env: Env, request?: Request): string {
  return `fp_session=; ${sessionCookieAttrs(env, request)}; Path=/; Max-Age=0`;
}
