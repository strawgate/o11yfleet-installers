import { z } from "zod";

const idSchema = z.string().trim().min(1).max(200);
const shortNameSchema = z.string().trim().min(1).max(255);
const descriptionSchema = z.string().max(2048);

const planIds = ["hobby", "pro", "starter", "growth", "enterprise"] as const;
const planList = planIds.join(", ");

export const planIdSchema = z.enum(planIds);
export type PlanId = z.infer<typeof planIdSchema>;

const adminPlanIdRequestSchema = z.string().transform((value, ctx) => {
  const parsed = planIdSchema.safeParse(value.trim().toLowerCase());
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid plan. Must be one of: ${planList}`,
    });
    return z.NEVER;
  }
  return parsed.data;
});

export const validationErrorDetailSchema = z.enum([
  "custom",
  "expected_array",
  "expected_boolean",
  "expected_number",
  "expected_object",
  "expected_positive_int",
  "expected_string",
  "invalid_enum",
  "invalid_item",
  "invalid_json",
  "invalid_type",
  "invalid_url",
  "invalid_url_protocol",
  "invalid_value",
  "required",
  "too_few_items",
  "too_large",
  "too_long",
  "too_many_items",
  "too_short",
  "unknown_field",
]);
export type ValidationErrorDetail = z.infer<typeof validationErrorDetailSchema>;

export const apiErrorResponseSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    field: z.string().optional(),
    detail: z.string().optional(),
  })
  .passthrough();
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export const validationErrorResponseSchema = apiErrorResponseSchema.extend({
  code: z.literal("validation_error"),
  field: z.string().optional(),
  detail: validationErrorDetailSchema.optional(),
});
export type ValidationErrorResponse = z.infer<typeof validationErrorResponseSchema>;

export const tenantStatusSchema = z.enum(["pending", "active", "suspended"]);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const authUserSchema = z
  .object({
    id: z.string().optional(),
    userId: z.string().optional(),
    email: z.string().email(),
    name: z.string().nullable().optional(),
    // displayName comes from `users.display_name`, which is nullable in
    // D1. Accept null/undefined/string so a freshly-created user without
    // a name doesn't trip Zod validation.
    displayName: z.string().nullable().optional(),
    role: z.enum(["member", "admin"]).or(z.string()).optional(),
    tenant_id: z.string().nullable().optional(),
    tenantId: z.string().nullable().optional(),
    // tenantStatus is included in the /auth/login response so the portal
    // can route to /pending-approval when a user logs in before their
    // tenant is approved. Optional so admin-scoped /me responses (no
    // tenant binding) and other consumers don't need to provide it.
    // Nullable for the same reason as the other tenant_* fields above —
    // D1 left-joins return null, not undefined.
    tenantStatus: tenantStatusSchema.nullable().optional(),
    isImpersonation: z.boolean().optional(),
  })
  .passthrough()
  .refine((user) => Boolean(user.id ?? user.userId), {
    message: "user id is required",
    path: ["id"],
  })
  .transform((user) => ({
    ...user,
    id: (user.id ?? user.userId)!,
  }));
export type AuthUser = z.infer<typeof authUserSchema>;

export const authLoginRequestSchema = z
  .object({
    email: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(1024),
  })
  .strict();
export type AuthLoginRequest = z.output<typeof authLoginRequestSchema>;

export const authLoginResponseSchema = z
  .object({
    user: authUserSchema,
  })
  .strict();
export type AuthLoginResponse = z.infer<typeof authLoginResponseSchema>;

/**
 * Shape of the user object returned by /auth/me. Mirrors the worker's
 * AuthContext: includes tenantStatus, isImpersonation, impersonatorUserId
 * (which authUserSchema doesn't model explicitly). Strict — AuthContext
 * is internally defined and we don't carry extra fields through this
 * surface, so a strict schema catches drift.
 */
export const authMeUserSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  // displayName comes from `users.display_name`, nullable in D1.
  displayName: z.string().nullable().optional(),
  tenantId: z.string().nullable(),
  tenantStatus: tenantStatusSchema,
  role: z.enum(["member", "admin"]).or(z.string()),
  isImpersonation: z.boolean(),
  impersonatorUserId: z.string().nullable(),
});
export type AuthMeUser = z.infer<typeof authMeUserSchema>;

export const authMeResponseSchema = z.object({
  user: authMeUserSchema,
});
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;

/** /auth/logout — simple ack. */
export const authLogoutResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();
export type AuthLogoutResponse = z.infer<typeof authLogoutResponseSchema>;

/** /auth/seed — dev-only seed result. */
export const authSeedResponseSchema = z
  .object({
    seeded: z.array(z.string()),
    tenantId: idSchema,
  })
  .strict();
export type AuthSeedResponse = z.infer<typeof authSeedResponseSchema>;

export const tenantSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    plan: planIdSchema.or(z.string()),
    status: tenantStatusSchema.optional(),
    approved_at: z.string().nullable().optional(),
    max_configs: z.number().int().min(0).optional(),
    max_agents_per_config: z.number().int().min(0).optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();
export type Tenant = z.infer<typeof tenantSchema>;

/**
 * Admin tenant detail response. Same as Tenant plus the join-aggregated
 * stats fields that admin endpoints compute over configurations and agents.
 * The base shape uses passthrough() so unknown fields still flow through.
 */
export const adminTenantSchema = tenantSchema.extend({
  config_count: z.number().int().min(0).optional(),
  agent_count: z.number().int().min(0).optional(),
  connected_agents: z.number().int().min(0).optional(),
  healthy_agents: z.number().int().min(0).optional(),
});
export type AdminTenant = z.infer<typeof adminTenantSchema>;

export const adminCreateTenantRequestSchema = z
  .object({
    name: shortNameSchema,
    plan: adminPlanIdRequestSchema.optional(),
  })
  .strict();
export type AdminCreateTenantRequest = z.output<typeof adminCreateTenantRequestSchema>;

export const adminUpdateTenantRequestSchema = z
  .object({
    name: shortNameSchema.optional(),
    geo_enabled: z.boolean().optional(),
    plan: adminPlanIdRequestSchema.optional(),
    status: tenantStatusSchema.optional(),
  })
  .strict();
export type AdminUpdateTenantRequest = z.output<typeof adminUpdateTenantRequestSchema>;

export const adminApproveTenantRequestSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    reason: z.string().max(500).optional(),
  })
  .strict();
export type AdminApproveTenantRequest = z.infer<typeof adminApproveTenantRequestSchema>;

export const adminBulkApproveRequestSchema = z
  .object({
    tenant_ids: z.array(idSchema).min(1).max(100),
  })
  .strict();
export type AdminBulkApproveRequest = z.infer<typeof adminBulkApproveRequestSchema>;

export const adminBulkApproveResponseSchema = z
  .object({
    approved: z.array(z.string()),
    failed: z.array(
      z.object({
        id: z.string(),
        error: z.string(),
      }),
    ),
  })
  .strict();
export type AdminBulkApproveResponse = z.infer<typeof adminBulkApproveResponseSchema>;

export const adminSettingsSchema = z
  .object({
    auto_approve_signups: z.boolean(),
  })
  .strict();
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

/**
 * `metrics_source` reports whether fleet metrics came from Analytics
 * Engine SQL or are unavailable. Both admin overview and tenants-page
 * responses surface this so the UI can render an "UNAVAILABLE" badge
 * instead of stale zeros.
 */
const metricsSourceSchema = z.enum(["analytics_engine", "unavailable"]);

export const adminOverviewSchema = z
  .object({
    total_tenants: z.number().int().min(0),
    total_configurations: z.number().int().min(0),
    total_active_tokens: z.number().int().min(0),
    total_users: z.number().int().min(0),
    total_agents: z.number().int().min(0).nullable(),
    connected_agents: z.number().int().min(0).nullable(),
    healthy_agents: z.number().int().min(0).nullable(),
    metrics_source: metricsSourceSchema,
    metrics_error: z.string().nullable().optional(),
  })
  .passthrough();
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const adminTenantsPageSchema = z
  .object({
    tenants: z.array(adminTenantSchema),
    pagination: z.object({
      page: z.number().int().min(1),
      limit: z.number().int().min(1),
      total: z.number().int().min(0),
      has_more: z.boolean(),
    }),
    filters: z.object({
      q: z.string(),
      plan: z.string(),
      status: z.string().nullable(),
      sort: z.string(),
    }),
    status_counts: z.record(z.string(), z.number()),
    metrics_source: metricsSourceSchema,
    metrics_error: z.string().nullable().optional(),
  })
  .passthrough();
export type AdminTenantsPage = z.infer<typeof adminTenantsPageSchema>;

/** Plan definition + tenant headcount for the admin Plans page. */
export const adminPlanSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    tenant_count: z.number().int().min(0),
  })
  .passthrough();
export type AdminPlan = z.infer<typeof adminPlanSchema>;

export const adminListPlansResponseSchema = z.object({
  plans: z.array(adminPlanSchema),
});
export type AdminListPlansResponse = z.infer<typeof adminListPlansResponseSchema>;

/** Tenant configuration row as returned by the admin tenant-configs list.
 *  The route returns `{ configurations: [] }`. We use a passthrough shape
 *  with only `id` + `name` required because the admin UI only reads those
 *  two columns; the full Kysely row passes through unchanged. */
export const adminTenantConfigSchema = z
  .object({
    id: idSchema,
    name: z.string(),
  })
  .passthrough();
export type AdminTenantConfig = z.infer<typeof adminTenantConfigSchema>;

export const adminListTenantConfigsResponseSchema = z.object({
  configurations: z.array(adminTenantConfigSchema),
});
export type AdminListTenantConfigsResponse = z.infer<typeof adminListTenantConfigsResponseSchema>;

export const adminTenantUserSchema = z
  .object({
    id: idSchema,
    email: z.string(),
    display_name: z.string().nullable().optional(),
    role: z.string().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();
export type AdminTenantUser = z.infer<typeof adminTenantUserSchema>;

export const adminListTenantUsersResponseSchema = z.object({
  users: z.array(adminTenantUserSchema),
});
export type AdminListTenantUsersResponse = z.infer<typeof adminListTenantUsersResponseSchema>;

/**
 * Health endpoint shape — checks/sources are Records<string, ...> because
 * the set of probes evolves; passthrough keeps unknown keys flowing
 * through. This is the customer-facing "control plane health" payload.
 */
export const adminHealthCheckSchema = z
  .object({
    status: z.string().optional(),
    latency_ms: z.number().nullable().optional(),
    error: z.string().optional(),
    detail: z.string().optional(),
  })
  .passthrough();

export const adminHealthDataSourceSchema = z
  .object({
    status: z.string().optional(),
    detail: z.string().optional(),
  })
  .passthrough();

export const adminHealthMetricsSchema = z
  .object({
    total_tenants: z.number().int(),
    total_configurations: z.number().int(),
    tenants_without_configurations: z.number().int(),
    configurations_without_agents: z.number().int(),
    total_users: z.number().int(),
    active_sessions: z.number().int(),
    impersonation_sessions: z.number().int(),
    active_tokens: z.number().int(),
    total_agents: z.number().int(),
    connected_agents: z.number().int(),
    disconnected_agents: z.number().int(),
    unknown_agents: z.number().int(),
    healthy_agents: z.number().int(),
    unhealthy_agents: z.number().int(),
    stale_agents: z.number().int(),
    last_agent_seen_at: z.string().nullable(),
    latest_fleet_snapshot_at: z.string().nullable().optional(),
    latest_configuration_updated_at: z.string().nullable(),
    plan_counts: z.record(z.string(), z.number()),
  })
  .passthrough();

export const adminHealthSchema = z
  .object({
    status: z.string().optional(),
    checks: z.record(z.string(), adminHealthCheckSchema).optional(),
    metrics: adminHealthMetricsSchema.optional(),
    sources: z.record(z.string(), adminHealthDataSourceSchema).optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();
export type AdminHealth = z.infer<typeof adminHealthSchema>;

/**
 * Cloudflare usage estimation. Deeply nested — we shape the top level
 * with strict types and let `services` pass through (its children evolve
 * faster than the wrapper).
 */
export const adminUsageWindowSchema = z.object({
  start_date: z.string(),
  end_date: z.string(),
  days_elapsed: z.number(),
  days_in_month: z.number(),
});

export const adminUsageLineItemSchema = z
  .object({
    label: z.string(),
    quantity: z.number(),
    unit: z.string(),
    included: z.number(),
    billable: z.number(),
    unit_price_usd: z.number(),
    estimated_spend_usd: z.number(),
  })
  .passthrough();

export const adminUsageDailySchema = z
  .object({
    date: z.string(),
    estimated_spend_usd: z.number(),
    units: z.record(z.string(), z.number()),
  })
  .passthrough();

export const adminUsageServiceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(["ready", "not_configured", "error"]),
    source: z.string(),
    daily: z.array(adminUsageDailySchema),
    line_items: z.array(adminUsageLineItemSchema),
    month_to_date_estimated_spend_usd: z.number(),
    projected_month_estimated_spend_usd: z.number(),
    notes: z.array(z.string()),
    error: z.string().optional(),
  })
  .passthrough();
export type AdminUsageService = z.infer<typeof adminUsageServiceSchema>;
export type AdminUsageDaily = z.infer<typeof adminUsageDailySchema>;
export type AdminUsageLineItem = z.infer<typeof adminUsageLineItemSchema>;

export const adminUsageSchema = z
  .object({
    configured: z.boolean(),
    currency: z.literal("USD"),
    generated_at: z.string(),
    window: adminUsageWindowSchema,
    pricing: z.object({
      source: z.string(),
      notes: z.array(z.string()),
    }),
    required_env: z.array(z.string()),
    services: z.array(adminUsageServiceSchema),
    month_to_date_estimated_spend_usd: z.number(),
    projected_month_estimated_spend_usd: z.number(),
  })
  .passthrough();
export type AdminUsage = z.infer<typeof adminUsageSchema>;

/** Result of a debug DO SELECT query — opaque rows + row count. */
export const adminDoQueryResponseSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  row_count: z.number().int().min(0),
});
export type AdminDoQueryResponse = z.infer<typeof adminDoQueryResponseSchema>;

/** Tenant approve/reject result. */
export const adminApproveTenantResponseSchema = z.object({
  success: z.boolean(),
  status: z.enum(["active", "suspended"]),
  tenantId: idSchema,
});
export type AdminApproveTenantResponse = z.infer<typeof adminApproveTenantResponseSchema>;

const debugSqlParamSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const debugReadSqlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine((sql) => /^select\b/i.test(sql) && !sql.includes(";"), {
    message: "Only single SELECT queries are allowed",
  });

export const adminDoQueryRequestSchema = z
  .object({
    sql: debugReadSqlSchema,
    params: z.array(debugSqlParamSchema).max(100).optional(),
  })
  .strict();
export type AdminDoQueryRequest = z.output<typeof adminDoQueryRequestSchema>;

export const configurationSchema = z
  .object({
    id: idSchema,
    tenant_id: idSchema,
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    current_config_hash: z.string().nullable().optional(),
    status: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();
export type Configuration = z.infer<typeof configurationSchema>;

export const createConfigurationRequestSchema = z
  .object({
    name: shortNameSchema,
    description: descriptionSchema.optional(),
  })
  .strict();
export type CreateConfigurationRequest = z.output<typeof createConfigurationRequestSchema>;

export const updateConfigurationRequestSchema = z
  .object({
    name: shortNameSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict();
export type UpdateConfigurationRequest = z.output<typeof updateConfigurationRequestSchema>;

export const createConfigurationResponseSchema = z
  .object({
    id: idSchema,
    tenant_id: idSchema,
    name: z.string().min(1),
  })
  .strict();
export type CreateConfigurationResponse = z.infer<typeof createConfigurationResponseSchema>;

export const createEnrollmentTokenRequestSchema = z
  .object({
    label: z.string().trim().max(255).optional(),
    expires_in_hours: z.number().int().positive().max(8760).optional(),
  })
  .strict();
export type CreateEnrollmentTokenRequest = z.output<typeof createEnrollmentTokenRequestSchema>;

export const createEnrollmentTokenResponseSchema = z
  .object({
    id: idSchema,
    token: z.string().min(1),
    config_id: idSchema,
    label: z.string().nullable(),
    expires_at: z.string().nullable(),
  })
  .strict();
export type CreateEnrollmentTokenResponse = z.infer<typeof createEnrollmentTokenResponseSchema>;

export const createPendingTokenRequestSchema = z
  .object({
    label: z.string().trim().max(255).optional(),
    target_config_id: idSchema.optional(),
  })
  .strict();
export type CreatePendingTokenRequest = z.output<typeof createPendingTokenRequestSchema>;

export const updateTenantRequestSchema = z
  .object({
    name: shortNameSchema.optional(),
    geo_enabled: z.boolean().optional(),
  })
  .strict();
export type UpdateTenantRequest = z.output<typeof updateTenantRequestSchema>;

export const setDesiredConfigRequestSchema = z
  .object({
    config_hash: z.string().trim().min(1).max(128),
    config_content: z
      .string()
      .max(256 * 1024)
      .nullable()
      .optional(),
  })
  .strict();
export type SetDesiredConfigRequest = z.output<typeof setDesiredConfigRequestSchema>;

// ─── Response Schemas ───────────────────────────────────────────────
// Canonical shapes for every API response. The worker validates outbound
// data against these; the site infers types from them; test mocks use
// `satisfies` to stay in sync.

/** Sweep stats embedded in config stats. */
export const sweepStatsSchema = z.object({
  last_sweep_at: z.number(),
  last_sweep_stale_count: z.number(),
  last_sweep_active_socket_count: z.number(),
  last_sweep_duration_ms: z.number(),
  last_stale_sweep_at: z.number(),
  total_sweeps: z.number(),
  total_stale_swept: z.number(),
  sweeps_with_stale: z.number(),
});
export type SweepStats = z.infer<typeof sweepStatsSchema>;

/** Per-config stats returned by DO /stats and embedded in overview. */
export const configStatsSchema = z.object({
  total_agents: z.number(),
  connected_agents: z.number(),
  healthy_agents: z.number(),
  drifted_agents: z.number().optional(),
  status_counts: z.record(z.string(), z.number()).optional(),
  current_hash_counts: z.array(z.object({ value: z.string(), count: z.number() })).optional(),
  desired_config_hash: z.string().nullable().optional(),
  active_websockets: z.number().optional(),
  snapshot_at: z.union([z.string(), z.number()]).nullable().optional(),
  stale_sweep: sweepStatsSchema.optional(),
});
export type ConfigStats = z.infer<typeof configStatsSchema>;

/** Configuration with optional embedded stats (as returned in overview). */
export const configurationWithStatsSchema = configurationSchema.extend({
  stats: configStatsSchema.optional(),
});
export type ConfigurationWithStats = z.infer<typeof configurationWithStatsSchema>;

/** Portal overview response. */
export const overviewResponseSchema = z.object({
  tenant: tenantSchema,
  configs_count: z.number(),
  total_agents: z.number(),
  connected_agents: z.number(),
  healthy_agents: z.number(),
  active_rollouts: z.number().nullable().optional(),
  configurations: z.array(configurationWithStatsSchema),
  metrics_source: z.enum(["analytics_engine", "unavailable"]).optional(),
  metrics_error: z.string().nullable().optional(),
});
export type OverviewResponse = z.infer<typeof overviewResponseSchema>;

/** Key-value attribute pair (used in agent_description). */
const kvAttributeSchema = z.object({
  key: z.string(),
  value: z
    .object({
      string_value: z.string().optional(),
      int_value: z.number().optional(),
      bool_value: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
});

/** Agent description (parsed from JSON blob). */
export const agentDescriptionResponseSchema = z.object({
  identifying_attributes: z.array(kvAttributeSchema).optional(),
  non_identifying_attributes: z.array(kvAttributeSchema).optional(),
});
export type AgentDescriptionResponse = z.infer<typeof agentDescriptionResponseSchema>;

/** Agent row in list responses. */
export const agentSchema = z.object({
  instance_uid: z.string(),
  tenant_id: z.string().optional(),
  config_id: z.string().optional(),
  sequence_num: z.number().optional(),
  generation: z.number().optional(),
  healthy: z.union([z.boolean(), z.number()]).nullable().optional(),
  status: z.string().optional(),
  last_error: z.string().nullable().optional(),
  current_config_hash: z.string().nullable().optional(),
  effective_config_hash: z.string().nullable().optional(),
  last_seen_at: z.number().nullable().optional(),
  connected_at: z.number().nullable().optional(),
  agent_description: z.union([z.string(), agentDescriptionResponseSchema]).nullable().optional(),
  capabilities: z.number().nullable().optional(),
  component_health_map: z.record(z.string(), z.unknown()).nullable().optional(),
  available_components: z.record(z.string(), z.unknown()).nullable().optional(),
  hostname: z.string().nullable().optional(),
  is_connected: z.boolean().optional(),
  is_drifted: z.boolean().optional(),
  desired_config_hash: z.string().nullable().optional(),
  effective_config_body: z.string().nullable().optional(),
  uptime_ms: z.number().nullable().optional(),
});
export type Agent = z.infer<typeof agentSchema>;

/** Single-agent detail response (agent row + live enrichment). */
export const agentDetailSchema = agentSchema.extend({
  is_connected: z.boolean(),
  desired_config_hash: z.string().nullable().optional(),
  is_drifted: z.boolean(),
  uptime_ms: z.number().nullable(),
  effective_config_body: z.string().nullable().optional(),
  component_health_map: z.record(z.string(), z.unknown()).nullable(),
  available_components: z.record(z.string(), z.unknown()).nullable(),
});
export type AgentDetail = z.infer<typeof agentDetailSchema>;

// ─── Audit Logs ─────────────────────────────────────────────────────

export const auditLogActorSchema = z.object({
  user_id: z.string().nullable(),
  api_key_id: z.string().nullable(),
  email: z.string().nullable(),
  ip: z.string().nullable(),
  user_agent: z.string().nullable(),
  impersonator_user_id: z.string().nullable(),
});
export type AuditLogActor = z.infer<typeof auditLogActorSchema>;

export const auditLogEntrySchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  actor: auditLogActorSchema,
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.string().nullable(),
  status: z.enum(["success", "failure"]),
  status_code: z.number().int().min(100).max(599).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  request_id: z.string().nullable(),
  created_at: z.string(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogListResponseSchema = z.object({
  entries: z.array(auditLogEntrySchema),
  next_cursor: z.string().nullable(),
});
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;

/** Paginated agent list response. */
export const agentPageSchema = z.object({
  agents: z.array(agentSchema),
  pagination: z.object({
    limit: z.number(),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
    sort: z.enum(["last_seen_desc", "last_seen_asc", "instance_uid_asc"]),
  }),
  filters: z.object({
    q: z.string().optional(),
    status: z.string().optional(),
    health: z.enum(["healthy", "unhealthy", "unknown"]).optional(),
  }),
});
export type AgentPage = z.infer<typeof agentPageSchema>;

// ─── Configuration versions, tokens, diff ───────────────────────────

export const configVersionSchema = z
  .object({
    id: z.string(),
    version: z.number(),
    config_hash: z.string().optional(),
    size_bytes: z.number().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();
export type ConfigVersion = z.infer<typeof configVersionSchema>;

export const enrollmentTokenSchema = z
  .object({
    id: z.string(),
    token: z.string().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();
export type EnrollmentToken = z.infer<typeof enrollmentTokenSchema>;

const versionDiffSideSchema = z.object({
  id: z.string(),
  config_hash: z.string(),
  size_bytes: z.number(),
  created_at: z.string(),
});

export const configurationVersionDiffSchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
  versions_seen: z.number().optional(),
  latest: versionDiffSideSchema.optional(),
  previous: versionDiffSideSchema.optional(),
  diff: z
    .object({
      previous_line_count: z.number(),
      latest_line_count: z.number(),
      line_count_delta: z.number(),
      size_bytes_delta: z.number(),
      added_lines: z.number(),
      removed_lines: z.number(),
    })
    .optional(),
});
export type ConfigurationVersionDiff = z.infer<typeof configurationVersionDiffSchema>;

// ─── Rollout cohort ──────────────────────────────────────────────────

export const rolloutCohortSummarySchema = z.object({
  total_agents: z.number(),
  connected_agents: z.number(),
  healthy_agents: z.number(),
  drifted_agents: z.number(),
  desired_config_hash: z.string().nullable(),
  status_counts: z.record(z.string(), z.number()),
  current_hash_counts: z.array(z.object({ value: z.string(), count: z.number() })),
});
export type RolloutCohortSummary = z.infer<typeof rolloutCohortSummarySchema>;

// ─── Team ────────────────────────────────────────────────────────────

export const teamMemberSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    role: z.string().optional(),
  })
  .passthrough();
export type TeamMember = z.infer<typeof teamMemberSchema>;

// ─── Fleet command results ──────────────────────────────────────────

export const restartFleetResultSchema = z.object({
  restarted: z.number(),
  skipped_no_cap: z.number(),
});
export type RestartFleetResult = z.infer<typeof restartFleetResultSchema>;

export const disconnectFleetResultSchema = z.object({
  disconnect_requested: z.number(),
});
export type DisconnectFleetResult = z.infer<typeof disconnectFleetResultSchema>;

export const restartAgentResultSchema = z.object({
  restarted: z.boolean(),
  reason: z.string().optional(),
});
export type RestartAgentResult = z.infer<typeof restartAgentResultSchema>;

export const disconnectAgentResultSchema = z.object({
  disconnected: z.boolean(),
});
export type DisconnectAgentResult = z.infer<typeof disconnectAgentResultSchema>;

// ─── Pending devices and tokens ─────────────────────────────────────

export const pendingDeviceSchema = z.object({
  instance_uid: z.string(),
  tenant_id: z.string(),
  display_name: z.string().nullable(),
  source_ip: z.string().nullable(),
  geo_country: z.string().nullable(),
  geo_city: z.string().nullable(),
  geo_lat: z.number().nullable(),
  geo_lon: z.number().nullable(),
  agent_description: z.string().nullable(),
  connected_at: z.number(),
  last_seen_at: z.number(),
});
export type PendingDevice = z.infer<typeof pendingDeviceSchema>;

export const pendingTokenSchema = z.object({
  id: z.string(),
  token: z.string().optional(),
  label: z.string().nullable(),
  target_config_id: z.string().nullable(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
export type PendingToken = z.infer<typeof pendingTokenSchema>;
