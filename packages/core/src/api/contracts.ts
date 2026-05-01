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

export const authUserSchema = z
  .object({
    id: z.string().optional(),
    userId: z.string().optional(),
    email: z.string().email(),
    name: z.string().optional(),
    displayName: z.string().optional(),
    role: z.enum(["member", "admin"]).or(z.string()).optional(),
    tenant_id: z.string().nullable().optional(),
    tenantId: z.string().nullable().optional(),
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

export const tenantStatusSchema = z.enum(["pending", "active", "suspended"]);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

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
  component_health_map: z.record(z.unknown()).nullable(),
  available_components: z.record(z.unknown()).nullable(),
});
export type AgentDetail = z.infer<typeof agentDetailSchema>;

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
