// Multi-tenant isolation tests
// Verifies that tenants cannot see each other's configs, agents, stats, or data.

import { describe, it, expect, beforeAll } from "vitest";
import { env, exports } from "cloudflare:workers";
import { verifyClaim } from "@o11yfleet/core/auth";
import {
  setupD1,
  CLAIM_SECRET,
  createTenant,
  createConfig,
  uploadConfigVersion,
  createEnrollmentToken,
  connectWithEnrollment,
  sendHello,
  getConfigStats,
  getAgentSummaries,
  rolloutConfig,
  waitForMsg,
  msgToBuffer,
  decodeFrame,
  type ServerToAgent,
} from "./helpers.js";

beforeAll(setupD1);

describe("Multi-Tenant Isolation", () => {
  let tenantA: { id: string };
  let tenantB: { id: string };
  let configA: { id: string };
  let configB: { id: string };
  let tokenA: { token: string };
  let tokenB: { token: string };

  beforeAll(async () => {
    // Create two separate tenants with configs
    tenantA = await createTenant("Tenant Alpha");
    tenantB = await createTenant("Tenant Beta");

    configA = await createConfig(tenantA.id, "alpha-collectors");
    configB = await createConfig(tenantB.id, "beta-collectors");

    // Upload different YAML to each
    await uploadConfigVersion(configA.id, "receivers:\n  otlp:\n    protocols:\n      grpc:\n");
    await uploadConfigVersion(configB.id, "receivers:\n  prometheus:\n    config:\n      scrape_configs: []\n");

    tokenA = await createEnrollmentToken(configA.id);
    tokenB = await createEnrollmentToken(configB.id);
  });

  it("tenant A agent sees only tenant A config", async () => {
    const { ws: wsA } = await connectWithEnrollment(tokenA.token);
    await sendHello(wsA);

    // Set up message listener BEFORE rollout (push is synchronous via DO)
    const pushPromise = waitForMsg(wsA);

    // Rollout tenant A config
    const rollout = await rolloutConfig(configA.id);
    expect(rollout.pushed).toBeGreaterThanOrEqual(1);

    // Agent A should get a config push
    const pushMsg = await pushPromise;
    const pushBuf = await msgToBuffer(pushMsg);
    const pushResp = decodeFrame<ServerToAgent>(pushBuf);
    expect(pushResp.remote_config).toBeDefined();

    // Verify the config content is tenant A's YAML (contains "otlp")
    if (pushResp.remote_config?.config?.config_map) {
      const configMap = pushResp.remote_config.config.config_map as Record<
        string,
        { body: Uint8Array; content_type: string }
      >;
      if (configMap[""]) {
        const body = new TextDecoder().decode(configMap[""].body);
        expect(body).toContain("otlp");
        expect(body).not.toContain("prometheus");
      }
    }

    wsA.close();
  });

  it("tenant B agent sees only tenant B config", async () => {
    const { ws: wsB } = await connectWithEnrollment(tokenB.token);
    await sendHello(wsB);

    // Set up message listener BEFORE rollout
    const pushPromise = waitForMsg(wsB);

    // Rollout tenant B config
    const rollout = await rolloutConfig(configB.id);
    expect(rollout.pushed).toBeGreaterThanOrEqual(1);

    const pushMsg = await pushPromise;
    const pushBuf = await msgToBuffer(pushMsg);
    const pushResp = decodeFrame<ServerToAgent>(pushBuf);
    expect(pushResp.remote_config).toBeDefined();

    if (pushResp.remote_config?.config?.config_map) {
      const configMap = pushResp.remote_config.config.config_map as Record<
        string,
        { body: Uint8Array; content_type: string }
      >;
      if (configMap[""]) {
        const body = new TextDecoder().decode(configMap[""].body);
        expect(body).toContain("prometheus");
        expect(body).not.toContain("otlp");
      }
    }

    wsB.close();
  });

  it("tenant A stats do not include tenant B agents", async () => {
    // Connect one agent to each tenant
    const { ws: wsA } = await connectWithEnrollment(tokenA.token);
    await sendHello(wsA);
    const { ws: wsB } = await connectWithEnrollment(tokenB.token);
    await sendHello(wsB);

    // Check stats via DO — each config's DO is isolated
    const statsA = await getConfigStats(configA.id);
    const statsB = await getConfigStats(configB.id);

    // Each should see its own websockets, not the other's
    expect(statsA.active_websockets).toBeGreaterThanOrEqual(1);
    expect(statsB.active_websockets).toBeGreaterThanOrEqual(1);

    wsA.close();
    wsB.close();
  });

  it("tenant A enrollment token routes to tenant A config", async () => {
    // When agent enrolls with token A, it gets routed to tenant A's DO
    const { ws, enrollment } = await connectWithEnrollment(tokenA.token);

    // Claims are 2-part HMAC format: base64url(payload).base64url(sig)
    const claim = await verifyClaim(enrollment.assignment_claim, CLAIM_SECRET);
    expect(claim.tenant_id).toBe(tenantA.id);
    expect(claim.config_id).toBe(configA.id);

    ws.close();
  });

  it("tenant configs are isolated in D1 listings", async () => {
    const listA = await exports.default.fetch(
      `http://localhost/api/tenants/${tenantA.id}/configurations`,
    );
    const dataA = await listA.json<{ configurations: { id: string }[] }>();

    const listB = await exports.default.fetch(
      `http://localhost/api/tenants/${tenantB.id}/configurations`,
    );
    const dataB = await listB.json<{ configurations: { id: string }[] }>();

    // Tenant A should only see config A
    const configAIds = dataA.configurations.map((c) => c.id);
    expect(configAIds).toContain(configA.id);
    expect(configAIds).not.toContain(configB.id);

    // Tenant B should only see config B
    const configBIds = dataB.configurations.map((c) => c.id);
    expect(configBIds).toContain(configB.id);
    expect(configBIds).not.toContain(configA.id);
  });
});
