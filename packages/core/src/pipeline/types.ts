export const PIPELINE_SIGNALS = ["logs", "metrics", "traces"] as const;
export const PIPELINE_ROLES = ["receiver", "processor", "exporter"] as const;

export type PipelineSignal = (typeof PIPELINE_SIGNALS)[number];
export type PipelineComponentRole = (typeof PIPELINE_ROLES)[number];

export type PipelineConfigScalar = string | number | boolean | null;
export type PipelineConfigValue =
  | PipelineConfigScalar
  | PipelineConfigValue[]
  | { [key: string]: PipelineConfigValue };
export type PipelineConfigObject = { [key: string]: PipelineConfigValue };

export interface PipelineCatalogItem {
  role: PipelineComponentRole;
  type: string;
  description: string;
  signals: PipelineSignal[];
  defaults: PipelineConfigObject;
}

export interface PipelineComponent {
  id: string;
  role: PipelineComponentRole;
  type: string;
  name: string;
  signals: PipelineSignal[];
  config: PipelineConfigObject;
}

export interface PipelineWire {
  from: string;
  to: string;
  signal: PipelineSignal;
}

export interface PipelineGraph {
  id: string;
  label: string;
  description?: string;
  components: PipelineComponent[];
  wires: PipelineWire[];
}

export type PipelineImportConfidence = "complete" | "partial" | "raw-only";

export interface PipelineImportWarning {
  code: string;
  message: string;
  path?: string;
}

export interface CollectorYamlImportResult {
  graph: PipelineGraph;
  confidence: PipelineImportConfidence;
  warnings: PipelineImportWarning[];
  rawSections: PipelineConfigObject;
}

export interface SignalPipeline {
  signal: PipelineSignal;
  receivers: string[];
  processors: string[];
  exporters: string[];
}

export interface PipelineValidationIssue {
  code: string;
  message: string;
  component_id?: string;
  wire?: PipelineWire;
}

export interface PipelineValidationResult {
  ok: boolean;
  errors: PipelineValidationIssue[];
  warnings: PipelineValidationIssue[];
  pipelines: SignalPipeline[];
}
