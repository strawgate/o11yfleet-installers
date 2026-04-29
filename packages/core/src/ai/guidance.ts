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

export const aiGuidanceIntentSchema = z.enum([
  "explain_page",
  "explain_metric",
  "summarize_table",
  "triage_state",
  "suggest_next_action",
  "draft_config_change",
]);

export const aiGuidanceSeveritySchema = z.enum(["notice", "warning", "critical"]);

const aiContextScalarSchema = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]);

export const aiPageMetricSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  value: aiContextScalarSchema,
  unit: z.string().trim().min(1).max(40).optional(),
  status: z.enum(["neutral", "ok", "warning", "critical"]).optional(),
  detail: z.string().trim().min(1).max(240).optional(),
});

export const aiPageTableSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  columns: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
  rows: z.array(z.record(aiContextScalarSchema)).max(50).default([]),
  total_rows: z.number().int().min(0).optional(),
});

export const aiPageDetailSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  value: aiContextScalarSchema,
  source: z.string().trim().min(1).max(120).optional(),
});

export const aiLightFetchSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  status: z.enum(["included", "unavailable", "skipped"]),
  data: z.unknown().optional(),
  error: z.string().trim().min(1).max(240).optional(),
});

export const aiPageContextSchema = z.object({
  route: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(160).optional(),
  active_tab: z.string().trim().min(1).max(120).optional(),
  filters: z.record(aiContextScalarSchema).optional(),
  visible_text: z.array(z.string().trim().min(1).max(500)).max(24).default([]),
  metrics: z.array(aiPageMetricSchema).max(32).default([]),
  tables: z.array(aiPageTableSchema).max(8).default([]),
  details: z.array(aiPageDetailSchema).max(48).default([]),
  selection: z
    .object({
      kind: z.enum(["metric", "table", "row", "editor_selection", "text"]),
      key: z.string().trim().min(1).max(160).optional(),
      label: z.string().trim().min(1).max(160).optional(),
      text: z.string().trim().min(1).max(2000).optional(),
      data: z.unknown().optional(),
    })
    .optional(),
  yaml: z
    .object({
      label: z.string().trim().min(1).max(160),
      content: z.string().max(50_000),
      truncated: z.boolean().default(false),
    })
    .optional(),
  light_fetches: z.array(aiLightFetchSchema).max(4).default([]),
});

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
    intent: aiGuidanceIntentSchema.default("suggest_next_action"),
    targets: z.array(aiGuidanceTargetSchema).min(1).max(32),
    context: z.record(z.unknown()).default({}),
    page_context: aiPageContextSchema.optional(),
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
export type AiGuidanceIntent = z.infer<typeof aiGuidanceIntentSchema>;
export type AiGuidanceSeverity = z.infer<typeof aiGuidanceSeveritySchema>;
export type AiGuidanceAction = z.infer<typeof aiGuidanceActionSchema>;
export type AiGuidanceEvidence = z.infer<typeof aiGuidanceEvidenceSchema>;
export type AiGuidanceTarget = z.infer<typeof aiGuidanceTargetSchema>;
export type AiPageMetric = z.infer<typeof aiPageMetricSchema>;
export type AiPageTable = z.infer<typeof aiPageTableSchema>;
export type AiPageDetail = z.infer<typeof aiPageDetailSchema>;
export type AiLightFetch = z.infer<typeof aiLightFetchSchema>;
export type AiPageContext = z.infer<typeof aiPageContextSchema>;
export type AiGuidanceItem = z.infer<typeof aiGuidanceItemSchema>;
export type AiGuidanceRequest = z.infer<typeof aiGuidanceRequestSchema>;
export type AiGuidanceResponse = z.infer<typeof aiGuidanceResponseSchema>;
