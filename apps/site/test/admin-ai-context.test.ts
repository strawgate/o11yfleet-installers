import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAdminAiOverviewContext, emailDomain } from "../src/pages/admin/ai-context-utils";

test("admin tenant AI user context uses email domains only", () => {
  const masked = emailDomain("sensitive.user+alerts@example.com");

  assert.equal(masked, "@example.com");
  assert.equal(masked.includes("sensitive.user"), false);
});

test("admin overview AI context is aggregate and ratio based", () => {
  const context = buildAdminAiOverviewContext(
    [
      { id: "tenant-1", name: "Acme", plan: "pro", config_count: 4, user_count: 2, max_configs: 5 },
      { id: "tenant-2", name: "Beta", plan: "pro", config_count: 0, user_count: 1, max_configs: 5 },
      {
        id: "tenant-3",
        name: "Delta",
        plan: "pro",
        config_count: 0,
        user_count: 1,
        max_configs: 5,
      },
      {
        id: "tenant-4",
        name: "Gamma",
        plan: "starter",
        config_count: 0,
        user_count: 0,
        max_configs: 2,
      },
      {
        id: "tenant-5",
        name: "Echo",
        plan: "starter",
        config_count: 0,
        user_count: 1,
        max_configs: 2,
      },
    ],
    5,
    4,
  );

  assert.equal(context.onboarding_gap_ratio, 4 / 5);
  assert.deepEqual(context.plan_zero_state_rates, [
    { plan: "pro", tenant_count: 3, zero_config_rate: 2 / 3, zero_user_rate: 0 },
    { plan: "starter", tenant_count: 2, zero_config_rate: 1, zero_user_rate: 0.5 },
  ]);
  assert.deepEqual(context.tenant_limit_utilization, [
    { plan: "pro", config_limit_utilization_ratio: 0.8 },
    { plan: "pro", config_limit_utilization_ratio: 0 },
    { plan: "pro", config_limit_utilization_ratio: 0 },
    { plan: "starter", config_limit_utilization_ratio: 0 },
    { plan: "starter", config_limit_utilization_ratio: 0 },
  ]);
  assert.equal(context.tenant_config_concentration_top3_ratio, 1);
  assert.equal(JSON.stringify(context).includes("Acme"), false);
});

test("admin overview AI ratios are suppressed for small tenant cohorts", () => {
  const context = buildAdminAiOverviewContext(
    [
      { id: "tenant-1", name: "Acme", plan: "pro", config_count: 4, user_count: 2, max_configs: 5 },
      { id: "tenant-2", name: "Beta", plan: "pro", config_count: 0, user_count: 1, max_configs: 5 },
      {
        id: "tenant-3",
        name: "Gamma",
        plan: "starter",
        config_count: 0,
        user_count: 0,
        max_configs: 2,
      },
    ],
    3,
    4,
  );

  assert.equal(context.onboarding_gap_ratio, 0);
  assert.deepEqual(context.plan_zero_state_rates, []);
  assert.deepEqual(context.tenant_limit_utilization, []);
  assert.equal(context.tenant_config_concentration_top3_ratio, 0);
});

test("admin overview AI ratios are suppressed when the tenant sample is incomplete", () => {
  const context = buildAdminAiOverviewContext(
    [
      { id: "tenant-1", name: "Acme", plan: "pro", config_count: 0, user_count: 1 },
      { id: "tenant-2", name: "Beta", plan: "pro", config_count: 1, user_count: 1 },
    ],
    100,
    1,
  );

  assert.equal(context.onboarding_gap_ratio, 0);
  assert.deepEqual(context.plan_zero_state_rates, []);
  assert.deepEqual(context.tenant_limit_utilization, []);
  assert.equal(context.tenant_config_concentration_top3_ratio, 0);
});

test("admin overview AI ratios are suppressed when tenant totals disagree", () => {
  const context = buildAdminAiOverviewContext(
    [
      { id: "tenant-1", name: "Acme", plan: "pro", config_count: 0, user_count: 1 },
      { id: "tenant-2", name: "Beta", plan: "pro", config_count: 1, user_count: 1 },
      { id: "tenant-3", name: "Delta", plan: "pro", config_count: 0, user_count: 1 },
      { id: "tenant-4", name: "Gamma", plan: "starter", config_count: 0, user_count: 0 },
      { id: "tenant-5", name: "Echo", plan: "starter", config_count: 0, user_count: 1 },
    ],
    4,
    1,
  );

  assert.equal(context.onboarding_gap_ratio, 0);
  assert.deepEqual(context.plan_zero_state_rates, []);
  assert.deepEqual(context.tenant_limit_utilization, []);
  assert.equal(context.tenant_config_concentration_top3_ratio, 0);
});

test("admin overview AI context clamps negative count fields", () => {
  const context = buildAdminAiOverviewContext(
    [
      {
        id: "tenant-1",
        name: "Acme",
        plan: "pro",
        config_count: -1,
        user_count: -1,
        max_configs: 5,
      },
      { id: "tenant-2", name: "Beta", plan: "pro", config_count: 1, user_count: 1, max_configs: 5 },
      {
        id: "tenant-3",
        name: "Delta",
        plan: "pro",
        config_count: 0,
        user_count: 1,
        max_configs: 5,
      },
      {
        id: "tenant-4",
        name: "Gamma",
        plan: "starter",
        config_count: 0,
        user_count: 0,
        max_configs: 2,
      },
      {
        id: "tenant-5",
        name: "Echo",
        plan: "starter",
        config_count: 0,
        user_count: 1,
        max_configs: 2,
      },
    ],
    5,
    1,
  );

  assert.equal(context.onboarding_gap_ratio, 4 / 5);
  assert.deepEqual(context.tenant_limit_utilization, [
    { plan: "pro", config_limit_utilization_ratio: 0 },
    { plan: "pro", config_limit_utilization_ratio: 0.2 },
    { plan: "pro", config_limit_utilization_ratio: 0 },
    { plan: "starter", config_limit_utilization_ratio: 0 },
    { plan: "starter", config_limit_utilization_ratio: 0 },
  ]);
});

test("admin overview AI context caps concentration at one", () => {
  const context = buildAdminAiOverviewContext(
    [
      { id: "tenant-1", name: "Acme", plan: "pro", config_count: 4, user_count: 2, max_configs: 5 },
      { id: "tenant-2", name: "Beta", plan: "pro", config_count: 3, user_count: 1, max_configs: 5 },
      {
        id: "tenant-3",
        name: "Delta",
        plan: "pro",
        config_count: 2,
        user_count: 1,
        max_configs: 5,
      },
      {
        id: "tenant-4",
        name: "Gamma",
        plan: "starter",
        config_count: 0,
        user_count: 0,
        max_configs: 2,
      },
      {
        id: "tenant-5",
        name: "Echo",
        plan: "starter",
        config_count: 0,
        user_count: 1,
        max_configs: 2,
      },
    ],
    5,
    5,
  );

  assert.equal(context.tenant_config_concentration_top3_ratio, 1);
});
