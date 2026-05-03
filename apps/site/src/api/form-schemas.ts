import { z } from "zod";

/**
 * Shared Zod schemas for portal/admin forms.
 *
 * Why these live here instead of inline in each page:
 * - Pre-trimmed validation: every name field rejects whitespace-only and
 *   trims before submission, so backend payloads are normalized at the
 *   form boundary.
 * - One place to evolve constraints: if a tenant name suddenly needs to
 *   be ≤ 64 chars (a likely backend tightening), one edit covers every
 *   create/update form.
 * - Type inference: `z.infer<typeof tenantSettingsSchema>` produces the
 *   exact form-values type, eliminating the manual interface duplication
 *   we had with the Mantine form's bare `validate` callbacks.
 *
 * Pair with `mantine-form-zod-resolver`'s `zodResolver(schema)` in each
 * page's `useForm({ validate: zodResolver(schema) })`.
 */

const trimmedRequired = (label: string, max = 100) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

const optionalLabel = (max = 50) =>
  z
    .string()
    .trim()
    .max(max, `Label must be ${max} characters or fewer`)
    .optional()
    .or(z.literal(""));

const planId = z.string().min(1, "Plan is required");

/**
 * Workspace settings (portal). Only the user-editable fields — `id` and
 * other server-owned attributes are not in the schema.
 */
export const workspaceSettingsSchema = z.object({
  name: trimmedRequired("Workspace name"),
  geoEnabled: z.boolean(),
});
export type WorkspaceSettingsValues = z.infer<typeof workspaceSettingsSchema>;

/**
 * Admin: create-tenant modal.
 */
export const createTenantSchema = z.object({
  name: trimmedRequired("Tenant name"),
  plan: planId,
});
export type CreateTenantValues = z.infer<typeof createTenantSchema>;

/**
 * Admin: tenant detail settings (rename + plan change).
 */
export const tenantSettingsSchema = z.object({
  name: trimmedRequired("Tenant name"),
  plan: planId,
});
export type TenantSettingsValues = z.infer<typeof tenantSettingsSchema>;

/**
 * Portal: create-configuration modal.
 */
export const createConfigurationSchema = z.object({
  name: trimmedRequired("Configuration name"),
  description: z.string().trim().max(500, "Description too long").optional().or(z.literal("")),
});
export type CreateConfigurationValues = z.infer<typeof createConfigurationSchema>;

/**
 * Portal: enrollment-token create modal.
 */
export const createEnrollmentTokenSchema = z.object({
  label: optionalLabel(),
});
export type CreateEnrollmentTokenValues = z.infer<typeof createEnrollmentTokenSchema>;

/**
 * Admin: pending-token create modal.
 */
export const createPendingTokenSchema = z.object({
  label: optionalLabel(),
  targetConfigId: z.string().nullable(),
});
export type CreatePendingTokenValues = z.infer<typeof createPendingTokenSchema>;

/**
 * Admin: assign pending device modal.
 */
export const assignPendingDeviceSchema = z.object({
  targetConfigId: z.string().min(1, "Select a configuration"),
});
export type AssignPendingDeviceValues = z.infer<typeof assignPendingDeviceSchema>;
