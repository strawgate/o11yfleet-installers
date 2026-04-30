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

export const tenantSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    plan: planIdSchema.or(z.string()),
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
    plan: adminPlanIdRequestSchema.optional(),
  })
  .strict();
export type AdminUpdateTenantRequest = z.output<typeof adminUpdateTenantRequestSchema>;

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
  .passthrough();
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
  .passthrough();
export type CreateEnrollmentTokenResponse = z.infer<typeof createEnrollmentTokenResponseSchema>;

export const updateTenantRequestSchema = z
  .object({
    name: shortNameSchema.optional(),
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
