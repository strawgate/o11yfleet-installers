import { describe, it, expect, beforeAll } from "vitest";
import { signClaim } from "@o11yfleet/core/auth";
import type { AssignmentClaim } from "@o11yfleet/core/auth";
import { AgentCapabilities, decodeFrame, encodeFrame } from "@o11yfleet/core/codec";
import type { AgentToServer, ServerToAgent } from "@o11yfleet/core/codec";
import { apiFetch, setupD1, O11YFLEET_CLAIM_HMAC_SECRET } from "./helpers.js";

beforeAll(setupD1);

describe("Ingress Router", () => {
  it("rejects requests without Authorization header", async () => {
    const response = await apiFetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket" },
    });
    expect(response.status).toBe(401);
  });

  it("rejects non-WebSocket requests", async () => {
    const response = await apiFetch("http://localhost/v1/opamp");
    expect(response.status).toBe(426);
  });

  it("rejects invalid assignment claim", async () => {
    const response = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: "Bearer invalid.claim.token",
      },
    });
    expect(response.status).toBe(401);
  });

  it("rejects expired assignment claim", async () => {
    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: "t1",
      config_id: "c1",
      instance_uid: "uid1",
      generation: 1,
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    const token = await signClaim(claim, O11YFLEET_CLAIM_HMAC_SECRET);
    const response = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${token}`,
      },
    });
    expect(response.status).toBe(401);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain("expired");
  });

  it("accepts valid assignment claim and routes to DO (WebSocket upgrade)", async () => {
    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: "tenant-ws",
      config_id: "config-ws",
      instance_uid: "abcdef0123456789",
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signClaim(claim, O11YFLEET_CLAIM_HMAC_SECRET);
    const response = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${token}`,
      },
    });
    // Should get a 101 WebSocket upgrade
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
    response.webSocket!.accept();
    response.webSocket!.close();
  });

  it("rejects invalid enrollment token", async () => {
    const response = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: "Bearer fp_enroll_nonexistent_token_value",
      },
    });
    expect(response.status).toBe(401);
  });

  it("strips spoofed x-fp-* headers", async () => {
    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: "real-tenant",
      config_id: "real-config",
      instance_uid: "real-uid-12345678",
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signClaim(claim, O11YFLEET_CLAIM_HMAC_SECRET);

    // Try to spoof headers — ingress should strip them and use claim values
    const response = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${token}`,
        "x-fp-tenant-id": "spoofed-tenant",
        "x-fp-config-id": "spoofed-config",
      },
    });
    // Should succeed (101) — spoofed headers stripped, claim values used
    expect(response.status).toBe(101);
    response.webSocket!.accept();
    response.webSocket!.close();
  });

  it("enrollment flow: create tenant, config, token, then connect", async () => {
    // Create tenant
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Enrollment Test", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    // Create config
    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "enroll-config" }),
      headers: { "Content-Type": "application/json" },
    });
    const config = await configRes.json<{ id: string }>();

    // Create enrollment token
    const tokenRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-token`,
      {
        method: "POST",
        body: JSON.stringify({ label: "test" }),
        headers: { "Content-Type": "application/json" },
      },
    );
    const tokenBody = await tokenRes.json<{ token: string }>();
    expect(tokenBody.token).toMatch(/^fp_enroll_/);

    // Connect with enrollment token
    const wsRes = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${tokenBody.token}`,
      },
    });
    expect(wsRes.status).toBe(101);
    expect(wsRes.webSocket).toBeDefined();

    // The DO waits for client-first message per OpAMP spec
    const ws = wsRes.webSocket!;
    ws.accept();

    // Send hello to trigger enrollment
    const hello: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };
    ws.send(encodeFrame(hello));

    // Read enrollment message (binary protobuf after protobuf-only refactor)
    // Inline Blob→ArrayBuffer to avoid extra async overhead on hot path
    const enrollmentMsg = await new Promise<ArrayBuffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout")), 5000);
      ws.addEventListener("message", (event) => {
        clearTimeout(timer);
        resolve(
          event.data instanceof Blob
            ? (event.data as Blob).arrayBuffer()
            : (event.data as ArrayBuffer),
        );
      });
    });

    const parsed = decodeFrame<ServerToAgent>(enrollmentMsg);
    expect(parsed.instance_uid).toBeDefined();

    ws.close();
  });

  it("accepts auth via ?token= query param (WebSocket client compat)", async () => {
    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: "qp-tenant",
      config_id: "qp-config",
      instance_uid: "qpuid123456789ab",
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const signed = await signClaim(claim, O11YFLEET_CLAIM_HMAC_SECRET);

    // Use query param instead of Authorization header
    const response = await apiFetch(
      `http://localhost/v1/opamp?token=${encodeURIComponent(signed)}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
    response.webSocket!.accept();
    response.webSocket!.close();
  });
});
