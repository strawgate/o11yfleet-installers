import { z } from "zod";

export const aiGuidanceSurfaceSchema = z.enum([
  "portal.overview",
  "portal.configuration",
  "portal.agent",
  "portal.builder",
  "admin.overview",
  "admin.tenant",
]);

export const aiGuidanceTargetKindSchema = z.enum([
  "page",
  "section",
  "metric",
  "table",
  "row",
  "editor_selection",
]);

export const aiGuidanceSeveritySchema = z.enum(["notice", "warning", "critical"]);

const aiGuidanceActionBaseSchema = z.object({
  label: z.string().trim().min(1).max(80),
  payload: z.record(z.unknown()).optional(),
});

export const aiGuidanceActionSchema = z.union([
  aiGuidanceActionBaseSchema.extend({
    kind: z.enum(["open_page", "open_configuration", "open_agent", "open_tenant"]),
    href: z.string().trim().min(1).max(500),
  }),
  aiGuidanceActionBaseSchema.extend({
    kind: z.literal("propose_config_change"),
    href: z.string().trim().max(500).optional(),
  }),
  z.object({
    kind: z.literal("none"),
    label: z.string().trim().min(1).max(80),
    href: z.undefined().optional(),
    payload: z.undefined().optional(),
  }),
]);

export const aiGuidanceActionKindSchema = z.enum([
  "open_page",
  "open_configuration",
  "open_agent",
  "open_tenant",
  "propose_config_change",
  "none",
]);

export const aiGuidanceEvidenceSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(240),
  source: z.string().trim().min(1).max(120).optional(),
});

export const aiGuidanceTargetSchema = z.object({
  key: z.string().trim().min(1).max(160),
  label: z.string().trim().min(1).max(160),
  surface: aiGuidanceSurfaceSchema,
  kind: aiGuidanceTargetKindSchema,
  context: z.record(z.unknown()).optional(),
});

export const aiGuidanceItemSchema = z.object({
  target_key: z.string().trim().min(1).max(160),
  headline: z.string().trim().min(1).max(160),
  detail: z.string().trim().min(1).max(800),
  severity: aiGuidanceSeveritySchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(aiGuidanceEvidenceSchema).max(6).default([]),
  action: aiGuidanceActionSchema.optional(),
});

export const aiGuidanceRequestSchema = z
  .object({
    surface: aiGuidanceSurfaceSchema,
    targets: z.array(aiGuidanceTargetSchema).min(1).max(32),
    context: z.record(z.unknown()).default({}),
    user_prompt: z.string().trim().max(1000).optional(),
  })
  .superRefine((request, ctx) => {
    const seenTargetKeys = new Set<string>();
    request.targets.forEach((target, index) => {
      if (target.surface !== request.surface) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "target surface must match request surface",
          path: ["targets", index, "surface"],
        });
      }
      if (seenTargetKeys.has(target.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "target keys must be unique",
          path: ["targets", index, "key"],
        });
      } else {
        seenTargetKeys.add(target.key);
      }
    });
  });

export const aiGuidanceResponseSchema = z.object({
  summary: z.string().trim().min(1).max(1000),
  items: z.array(aiGuidanceItemSchema).max(12),
  generated_at: z.string().datetime(),
  model: z.string().trim().min(1).max(120).optional(),
});

export type AiGuidanceSurface = z.infer<typeof aiGuidanceSurfaceSchema>;
export type AiGuidanceTargetKind = z.infer<typeof aiGuidanceTargetKindSchema>;
export type AiGuidanceSeverity = z.infer<typeof aiGuidanceSeveritySchema>;
export type AiGuidanceAction = z.infer<typeof aiGuidanceActionSchema>;
export type AiGuidanceEvidence = z.infer<typeof aiGuidanceEvidenceSchema>;
export type AiGuidanceTarget = z.infer<typeof aiGuidanceTargetSchema>;
export type AiGuidanceItem = z.infer<typeof aiGuidanceItemSchema>;
export type AiGuidanceRequest = z.infer<typeof aiGuidanceRequestSchema>;
export type AiGuidanceResponse = z.infer<typeof aiGuidanceResponseSchema>;
