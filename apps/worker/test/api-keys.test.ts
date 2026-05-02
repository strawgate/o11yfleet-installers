// Runtime integration tests for tenant-scoped API keys (fp_key_)

import { beforeAll, describe, expect, it } from "vitest";
import { apiFetch, createTenant, setupD1, O11YFLEET_CLAIM_HMAC_SECRET } from "./helpers.js";
import { generateApiKey } from "@o11yfleet/core/auth";

beforeAll(setupD1);

describe("tenant-scoped API keys", () => {
  it("can generate and use an API key to access tenant routes", async () => {
    const tenant = await createTenant(`API Key Test ${crypto.randomUUID()}`);

    // Generate an API key for this tenant
    const { token } = await generateApiKey({
      tenant_id: tenant.id,
      secret: O11YFLEET_CLAIM_HMAC_SECRET,
      label: "test key",
    });

    // Use the API key to list configurations (no X-Tenant-Id header needed)
    const res = await apiFetch("http://localhost/api/v1/configurations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ configurations: unknown[] }>();
    expect(Array.isArray(body.configurations)).toBe(true);
  });

  it("rejects tampered API keys with 401", async () => {
    const tenant = await createTenant(`API Key Tamper ${crypto.randomUUID()}`);
    const { token } = await generateApiKey({
      tenant_id: tenant.id,
      secret: O11YFLEET_CLAIM_HMAC_SECRET,
    });

    // Tamper with the signature
    const tampered = token.slice(0, -4) + "XXXX";
    const res = await apiFetch("http://localhost/api/v1/configurations", {
      headers: { Authorization: `Bearer ${tampered}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects expired API keys", async () => {
    const tenant = await createTenant(`API Key Expired ${crypto.randomUUID()}`);

    // Generate a key that expired 1 second ago
    const now = Math.floor(Date.now() / 1000);
    const { base64urlEncode } = await import("@o11yfleet/core/auth");
    const enc = new TextEncoder();
    const payload = { v: 1, tenant_id: tenant.id, iat: now - 100, exp: now - 1, jti: "exp-1" };
    const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(payload)));
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(O11YFLEET_CLAIM_HMAC_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
    const sigB64 = base64urlEncode(new Uint8Array(sig));
    const expiredToken = `fp_key_${payloadB64}.${sigB64}`;

    const res = await apiFetch("http://localhost/api/v1/configurations", {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("expired");
  });

  it("isolates tenants — cannot access another tenant's data via API key", async () => {
    const tenant1 = await createTenant(`API Key Tenant1 ${crypto.randomUUID()}`);
    const tenant2 = await createTenant(`API Key Tenant2 ${crypto.randomUUID()}`);

    // Create a config for tenant1 using Bearer secret
    const createRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      headers: {
        "X-Tenant-Id": tenant1.id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "tenant1-config" }),
    });
    expect(createRes.status).toBe(201);

    // Generate API key for tenant2
    const { token: tenant2Key } = await generateApiKey({
      tenant_id: tenant2.id,
      secret: O11YFLEET_CLAIM_HMAC_SECRET,
    });

    // Tenant2's key should see NO configs (they belong to tenant1)
    const res = await apiFetch("http://localhost/api/v1/configurations", {
      headers: { Authorization: `Bearer ${tenant2Key}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ configurations: unknown[] }>();
    expect(body.configurations).toHaveLength(0);
  });

  it("POST /api/v1/api-keys generates a key for the authenticated tenant", async () => {
    const tenant = await createTenant(`API Key Generate ${crypto.randomUUID()}`);

    const res = await apiFetch("http://localhost/api/v1/api-keys", {
      method: "POST",
      headers: {
        "X-Tenant-Id": tenant.id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: "my-key", expires_in_seconds: 86400 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json<{
      token: string;
      jti: string;
      expires_at: string;
      tenant_id: string;
    }>();
    expect(body.token).toMatch(/^fp_key_/);
    expect(body.jti).toBeTruthy();
    expect(body.expires_at).toBeTruthy();
    expect(body.tenant_id).toBe(tenant.id);

    // The generated key should work for API calls
    const configsRes = await apiFetch("http://localhost/api/v1/configurations", {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(configsRes.status).toBe(200);
  });
});
