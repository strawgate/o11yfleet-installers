// Auth routes — login, logout, session management, seed accounts

import type { Env } from "../index.js";
import { timingSafeEqual } from "../utils/crypto.js";
import { getPlanLimits } from "../shared/plans.js";

// ─── Helpers ────────────────────────────────────────────────────────

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** PBKDF2-SHA256 with 100k iterations (Cloudflare Workers max) */
async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
  salt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  const hashHex = Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `pbkdf2:100000:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const saltHex = parts[2]!;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const rehashed = await hashPassword(password, salt);
  // Timing-safe compare
  const enc = new TextEncoder();
  const a = enc.encode(rehashed);
  const b = enc.encode(stored);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

function sessionCookie(sessionId: string, maxAge: number): string {
  // SameSite=None required for cross-origin requests (pages.dev → workers.dev)
  return `fp_session=${sessionId}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
}

function clearSessionCookie(): string {
  return "fp_session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0";
}

// ─── Auth context (used by middleware) ──────────────────────────────

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  tenantId: string | null;
  role: "member" | "admin";
}

export async function authenticate(request: Request, env: Env): Promise<AuthContext | null> {
  const sessionId = getCookie(request, "fp_session");
  if (!sessionId) return null;

  const row = await env.FP_DB.prepare(
    `SELECT u.id as user_id, u.email, u.display_name, u.tenant_id, u.role
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > datetime('now')`,
  )
    .bind(sessionId)
    .first<{
      user_id: string;
      email: string;
      display_name: string;
      tenant_id: string | null;
      role: string;
    }>();

  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    tenantId: row.tenant_id,
    role: row.role as "member" | "admin",
  };
}

// ─── Route handler ──────────────────────────────────────────────────

export async function handleAuthRequest(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  if (path === "/auth/login" && method === "POST") return handleLogin(request, env);
  if (path === "/auth/logout" && method === "POST") return handleLogout(request, env);
  if (path === "/auth/me" && method === "GET") return handleMe(request, env);
  if (path === "/auth/seed" && method === "POST") {
    // Require Bearer API_SECRET to prevent unauthorized account creation
    const auth = request.headers.get("Authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token || !env.API_SECRET || !timingSafeEqual(token, env.API_SECRET)) {
      return jsonError("Unauthorized", 401);
    }
    return handleSeed(env);
  }

  return jsonError("Not found", 404);
}

// ─── POST /auth/login ───────────────────────────────────────────────

async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const email = body.email?.trim();
  const password = body.password;
  if (!email || !password) return jsonError("email and password are required", 400);

  const user = await env.FP_DB.prepare(
    "SELECT id, email, password_hash, display_name, role, tenant_id FROM users WHERE email = ?",
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      password_hash: string;
      display_name: string;
      role: string;
      tenant_id: string | null;
    }>();

  if (!user) return jsonError("Invalid email or password", 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return jsonError("Invalid email or password", 401);

  // Create session
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.FP_DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sessionId, user.id, expiresAt)
    .run();

  // Clean up expired sessions for this user (best-effort)
  await env.FP_DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at < datetime('now')")
    .bind(user.id)
    .run();

  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return Response.json(
    {
      user: {
        userId: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        tenantId: user.tenant_id,
      },
    },
    {
      headers: { "Set-Cookie": sessionCookie(sessionId, maxAge) },
    },
  );
}

// ─── POST /auth/logout ──────────────────────────────────────────────

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const sessionId = getCookie(request, "fp_session");
  if (sessionId) {
    await env.FP_DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}

// ─── GET /auth/me ───────────────────────────────────────────────────

async function handleMe(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth) return jsonError("Not authenticated", 401);
  return Response.json({ user: auth });
}

// ─── POST /auth/seed ────────────────────────────────────────────────
// Creates hardcoded accounts from env vars. Idempotent.

interface SeedEnv extends Env {
  SEED_TENANT_USER_EMAIL?: string;
  SEED_TENANT_USER_PASSWORD?: string;
  SEED_ADMIN_EMAIL?: string;
  SEED_ADMIN_PASSWORD?: string;
}

async function handleSeed(env: Env): Promise<Response> {
  const e = env as SeedEnv;
  const results: string[] = [];

  // Find the demo tenant (first tenant, or create one)
  let tenant = await env.FP_DB.prepare("SELECT id FROM tenants ORDER BY created_at LIMIT 1").first<{
    id: string;
  }>();
  if (!tenant) {
    const tenantId = crypto.randomUUID();
    const seedPlan = "pro";
    const { max_configs, max_agents_per_config } = getPlanLimits(seedPlan);
    await env.FP_DB.prepare(
      "INSERT INTO tenants (id, name, plan, max_configs, max_agents_per_config) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(tenantId, "Demo Org", seedPlan, max_configs, max_agents_per_config)
      .run();
    tenant = { id: tenantId };
    results.push(`Created demo tenant: ${tenantId}`);
  }

  // Seed tenant user
  const tenantEmail = e.SEED_TENANT_USER_EMAIL ?? "demo@o11yfleet.com";
  const tenantPassword = e.SEED_TENANT_USER_PASSWORD ?? "demo-password";
  const existingTenantUser = await env.FP_DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(tenantEmail)
    .first();
  if (!existingTenantUser) {
    const hash = await hashPassword(tenantPassword);
    const userId = crypto.randomUUID();
    await env.FP_DB.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, role, tenant_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(userId, tenantEmail, hash, "Demo User", "member", tenant.id)
      .run();
    results.push(`Created tenant user: ${tenantEmail}`);
  } else {
    // Update password in case it changed
    const hash = await hashPassword(tenantPassword);
    await env.FP_DB.prepare("UPDATE users SET password_hash = ? WHERE email = ?")
      .bind(hash, tenantEmail)
      .run();
    results.push(`Updated tenant user password: ${tenantEmail}`);
  }

  // Seed admin user
  const adminEmail = e.SEED_ADMIN_EMAIL ?? "admin@o11yfleet.com";
  const adminPassword = e.SEED_ADMIN_PASSWORD ?? "admin-password";
  const existingAdmin = await env.FP_DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(adminEmail)
    .first();
  if (!existingAdmin) {
    const hash = await hashPassword(adminPassword);
    const userId = crypto.randomUUID();
    await env.FP_DB.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, role, tenant_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(userId, adminEmail, hash, "Admin", "admin", null)
      .run();
    results.push(`Created admin user: ${adminEmail}`);
  } else {
    const hash = await hashPassword(adminPassword);
    await env.FP_DB.prepare("UPDATE users SET password_hash = ? WHERE email = ?")
      .bind(hash, adminEmail)
      .run();
    results.push(`Updated admin user password: ${adminEmail}`);
  }

  return Response.json({ seeded: results });
}
