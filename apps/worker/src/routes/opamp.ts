// OpAMP WebSocket ingress router.
//
// Extracted from index.ts (Phase 4). Handles three paths:
//   1. Hot path: signed assignment claim → verify HMAC → route to Config DO
//   2. Cold path: enrollment token → verify signature + revocation check → route to Config DO
//   3. Pending path: fp_pending_ token → verify HMAC → route to tenant:__pending__ DO

import type { Env } from "../index.js";
import { verifyClaim, verifyEnrollmentToken } from "@o11yfleet/core/auth";
import { getDb } from "../db/client.js";
import { PENDING_DO_CONFIG_ID } from "../durable-objects/constants.js";

/** Headers used internally — MUST be stripped from external requests to prevent spoofing. */
export const INTERNAL_HEADERS = [
  "x-fp-tenant-id",
  "x-fp-config-id",
  "x-fp-instance-uid",
  "x-fp-enrollment",
  "x-fp-codec",
  "x-fp-max-agents-per-config",
];

/**
 * Phase 3A — Ingress Router for OpAMP WebSocket connections
 *
 * Hot path: Assignment claim in Authorization header → verify locally → route to DO
 * Cold path: Enrollment token → hash → D1 lookup → route to DO
 * Security: Strip all x-fp-* headers from external requests
 */
export async function handleOpampRequest(request: Request, env: Env): Promise<Response> {
  // Must be WebSocket upgrade
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }

  // Auth: prefer Authorization header, fall back to ?token= query param
  // Query param is needed because browser/Node.js WebSocket API cannot set custom headers
  const url = new URL(request.url);
  const auth = request.headers.get("Authorization");
  let token: string | null = null;

  if (auth?.startsWith("Bearer ")) {
    token = auth.slice(7);
  } else if (url.searchParams.has("token")) {
    token = url.searchParams.get("token");
  }

  if (!token) {
    return Response.json({ error: "Authorization required" }, { status: 401 });
  }

  // Build clean headers — strip ALL external x-fp-* headers (security: header spoofing prevention)
  const cleanHeaders = new Headers(request.headers);
  for (const h of INTERNAL_HEADERS) {
    cleanHeaders.delete(h);
  }

  // Try hot path: signed assignment claim
  if (!token.startsWith("fp_enroll_") && !token.startsWith("fp_pending_")) {
    try {
      const claim = await verifyClaim(token, env.O11YFLEET_CLAIM_HMAC_SECRET);
      // Route to DO based on claim — HMAC verification is the only auth
      // gate here. The DO enforces agent limits from its own SQLite policy
      // (seeded via /init or /sync-policy), so no D1 query is needed.
      const doName = `${claim.tenant_id}:${claim.config_id}`;
      const doId = env.CONFIG_DO.idFromName(doName);
      const stub = env.CONFIG_DO.get(doId);

      // The DO derives tenant/config identity from ctx.id.name — no
      // x-fp-tenant-id/x-fp-config-id headers needed. Agent limits are
      // enforced from the DO's own SQLite policy (seeded via /init or
      // /sync-policy), so no D1 query is needed here either.
      cleanHeaders.set("x-fp-instance-uid", claim.instance_uid);

      return stub.fetch(
        new Request(request.url, {
          method: request.method,
          headers: cleanHeaders,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid claim";
      return Response.json({ error: msg }, { status: 401 });
    }
  }

  // Pending path: fp_pending_ token — route to tenant:__pending__ DO
  if (token.startsWith("fp_pending_")) {
    return handlePendingTokenRequest(request, env, token, cleanHeaders);
  }

  // Cold path: enrollment token — verify signature, then check the persisted
  // row for revoked_at. The signature alone is not enough: a token revoked
  // through DELETE /api/v1/configurations/:id/enrollment-tokens/:tokenId
  // would still pass signature verification until its expiry, so we have to
  // check the denylist before routing to the DO.

  // Step 1: Verify token signature — auth failure → 401
  let claim: Awaited<ReturnType<typeof verifyEnrollmentToken>>;
  try {
    claim = await verifyEnrollmentToken(token, env.O11YFLEET_CLAIM_HMAC_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid enrollment token";
    return Response.json({ error: msg }, { status: 401 });
  }

  // Step 2: Revocation check (OpAMP §6.1.1). Single PK lookup on
  // enrollment_tokens.id (the claim's jti). Enrollment is the cold path —
  // it runs at most once per agent, so the extra D1 round-trip is
  // acceptable. Heartbeats use signed assignment claims that bypass D1
  // entirely, so this stays out of the per-message critical path.
  //
  // A push-based denylist (admin-revoke fan-out → DO SQLite check) would
  // scale better under enrollment storms, but adds invalidation
  // complexity (which DOs to push to, ordering vs revoke completion,
  // crash recovery). Keeping this pull-based until enrollment QPS
  // actually requires the optimization.
  try {
    const row = await getDb(env.FP_DB)
      .selectFrom("enrollment_tokens")
      .select("revoked_at")
      .where("id", "=", claim.jti)
      .executeTakeFirst();
    if (!row) {
      return Response.json({ error: "Enrollment token not found" }, { status: 401 });
    }
    if (row.revoked_at) {
      return Response.json({ error: "Enrollment token revoked" }, { status: 401 });
    }
  } catch (err) {
    console.error("Enrollment revocation check failed:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }

  // Step 3: Route to DO. Agent limits are enforced by the DO from its own
  // SQLite policy (seeded via /init or /sync-policy from PR #426). Plan
  // enforcement (hobby/pro → must use pending flow) is handled at token
  // generation time: the admin API refuses to issue fp_enroll_ tokens for
  // plans that don't support direct enrollment.
  try {
    const doName = `${claim.tenant_id}:${claim.config_id}`;
    const doId = env.CONFIG_DO.idFromName(doName);
    const stub = env.CONFIG_DO.get(doId);

    const instanceUid = crypto.randomUUID().replace(/-/g, "");

    // Identity (tenant_id/config_id) flows via ctx.id.name on the DO;
    // only the per-agent uid + enrollment flag travel as headers.
    cleanHeaders.set("x-fp-instance-uid", instanceUid);
    cleanHeaders.set("x-fp-enrollment", "true");

    return stub.fetch(
      new Request(request.url, {
        method: request.method,
        headers: cleanHeaders,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("Enrollment cold path infrastructure error:", msg);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function handlePendingTokenRequest(
  request: Request,
  env: Env,
  token: string,
  cleanHeaders: Headers,
): Promise<Response> {
  const body = token.slice("fp_pending_".length);
  const dotIdx = body.indexOf(".");
  if (dotIdx === -1) {
    return Response.json({ error: "Invalid pending token format" }, { status: 401 });
  }

  const payload = body.slice(0, dotIdx);
  const signature = body.slice(dotIdx + 1);

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.O11YFLEET_CLAIM_HMAC_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(payload),
    );
    if (!valid) {
      return Response.json({ error: "Invalid pending token signature" }, { status: 401 });
    }
  } catch {
    return Response.json({ error: "Invalid pending token" }, { status: 401 });
  }

  let claim: { tenant_id: string; jti: string; exp: number };
  try {
    claim = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      tenant_id: string;
      jti: string;
      exp: number;
    };
  } catch {
    return Response.json({ error: "Malformed pending token payload" }, { status: 401 });
  }

  if (claim.exp > 0 && claim.exp < Date.now() / 1000) {
    return Response.json({ error: "Pending token expired" }, { status: 401 });
  }

  // Token revocation and geo_enabled — zero D1 queries on the pending path.
  //
  // Revocation: same reasoning as enrollment — HMAC + exp claim is the
  // primary gate. Revocation-push-to-DO is a future concern (avoids
  // permanently growing revocation lists).
  //
  // Geo headers: always forwarded from Cloudflare's cf-* headers (free,
  // already on the request). The DO decides whether to store them based
  // on its own policy.

  try {
    const doName = `${claim.tenant_id}:${PENDING_DO_CONFIG_ID}`;
    const doId = env.CONFIG_DO.idFromName(doName);
    const stub = env.CONFIG_DO.get(doId);

    const instanceUid = crypto.randomUUID().replace(/-/g, "");

    // Identity (tenant + __pending__) flows via ctx.id.name on the DO.
    cleanHeaders.set("x-fp-instance-uid", instanceUid);
    cleanHeaders.set("x-fp-enrollment", "true");

    // Always pass geo headers — CF provides them for free on every request
    const cfCountry = request.headers.get("cf-ipcountry");
    const cfCity = request.headers.get("cf-ipcity");
    const cfLat = request.headers.get("cf-ip-latitude");
    const cfLon = request.headers.get("cf-ip-longitude");
    if (cfCountry) cleanHeaders.set("x-fp-geo-country", cfCountry);
    if (cfCity) cleanHeaders.set("x-fp-geo-city", cfCity);
    if (cfLat) cleanHeaders.set("x-fp-geo-lat", cfLat);
    if (cfLon) cleanHeaders.set("x-fp-geo-lon", cfLon);

    return stub.fetch(
      new Request(request.url, {
        method: request.method,
        headers: cleanHeaders,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("Pending token infrastructure error:", msg);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
