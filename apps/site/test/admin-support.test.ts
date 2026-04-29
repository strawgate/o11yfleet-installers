import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSupportBrief,
  healthTone,
  type SupportSymptom,
} from "../src/pages/admin/support-model";

const symptom: SupportSymptom = {
  id: "config-not-applying",
  title: "Config not applying",
  summary: "Check the tenant config first.",
  whyItMatters: "It usually starts with desired config state.",
  steps: [
    {
      label: "Tenant configurations",
      description: "Open tenant config tab.",
      path: (tenantId) =>
        tenantId ? `/admin/tenants/${tenantId}?tab=configurations` : "/admin/tenants",
      requiresTenant: true,
    },
    {
      label: "System health",
      description: "Open health.",
      path: () => "/admin/health",
    },
  ],
};

test("maps health statuses to support chip tones", () => {
  assert.equal(healthTone("healthy"), "ok");
  assert.equal(healthTone("ok"), "ok");
  assert.equal(healthTone("degraded"), "warn");
  assert.equal(healthTone(undefined), "warn");
  assert.equal(healthTone("down"), "err");
});

test("builds a tenant-scoped support brief with health evidence and links", () => {
  const brief = buildSupportBrief({
    tenant: { id: "tenant_123", name: "Acme", plan: "pro" },
    symptom,
    health: {
      status: "degraded",
      checks: {
        durable_objects: { status: "ok", latency_ms: 12 },
        r2: { status: "error", error: "timeout" },
      },
    },
  });

  assert.match(brief, /Tenant: Acme \(tenant_123\)/);
  assert.match(brief, /Plan: pro/);
  assert.match(brief, /Symptom: Config not applying/);
  assert.match(brief, /Control-plane health: degraded/);
  assert.match(brief, /Durable Objects: ok, 12ms/);
  assert.match(brief, /R2: error, timeout/);
  assert.match(brief, /Tenant configurations: \/admin\/tenants\/tenant_123\?tab=configurations/);
  assert.match(brief, /System health: \/admin\/health/);
});
