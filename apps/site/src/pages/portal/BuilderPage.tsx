import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Group,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { CopyButton } from "../../components/common/CopyButton";
import { PrototypeBanner } from "../../components/common/PrototypeBanner";
import { usePortalGuidance } from "../../api/hooks/ai";
import { GuidancePanel } from "../../components/ai";
import { buildInsightRequest, insightSurfaces, insightTarget } from "../../ai/insight-registry";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";
import {
  PIPELINE_EXAMPLES,
  parseCollectorYamlToGraph,
  renderCollectorYaml,
  summarizePipelineGraph,
  validatePipelineGraph,
} from "@o11yfleet/core/pipeline";
import type {
  CollectorYamlImportResult,
  PipelineComponentRole,
  PipelineGraph,
} from "@o11yfleet/core/pipeline";
import {
  Canvas,
  layoutLR,
  toFlow,
  type BuilderEdge,
  type BuilderNode,
} from "@/components/pipeline-builder";
import { PageHeader, PageShell } from "@/components/app";

type BuilderMode = "visual" | "split" | "yaml";

const MODE_OPTIONS: { value: BuilderMode; label: string }[] = [
  { value: "visual", label: "Visual" },
  { value: "split", label: "Split" },
  { value: "yaml", label: "YAML" },
];

const ROLES: PipelineComponentRole[] = ["receiver", "processor", "exporter"];
const DEFAULT_EXAMPLE_ID = "edge-gateway";
const EMPTY_PIPELINE_GRAPH: PipelineGraph = {
  id: "empty",
  label: "No example configured",
  description: "No pipeline examples are available.",
  components: [],
  wires: [],
};
const IMPORTED_GRAPH_LABEL = "Imported Collector YAML";

function roleLabel(role: PipelineComponentRole): string {
  if (role === "receiver") return "Receivers";
  if (role === "processor") return "Processors";
  return "Exporters";
}

export default function BuilderPage() {
  const [mode, setMode] = useState<BuilderMode>("split");
  const [exampleId, setExampleId] = useState(DEFAULT_EXAMPLE_ID);
  const [yamlInput, setYamlInput] = useState("");
  const [importResult, setImportResult] = useState<CollectorYamlImportResult | null>(null);
  const [yamlPreviewError, setYamlPreviewError] = useState<string | null>(null);

  const insightSurface = insightSurfaces.portalBuilder;
  const exampleEntries = Object.entries(PIPELINE_EXAMPLES);
  const selectedExampleId = PIPELINE_EXAMPLES[exampleId]
    ? exampleId
    : (exampleEntries[0]?.[0] ?? EMPTY_PIPELINE_GRAPH.id);
  const exampleGraph = PIPELINE_EXAMPLES[selectedExampleId] ?? EMPTY_PIPELINE_GRAPH;
  const graph = importResult?.graph ?? exampleGraph;
  const rawSectionEntries = useMemo(
    () => (importResult ? Object.entries(importResult.rawSections) : []),
    [importResult],
  );
  const validation = useMemo(() => validatePipelineGraph(graph), [graph]);
  const [yamlPreview, setYamlPreview] = useState<string>("");
  useEffect(() => {
    setYamlPreviewError(null);
    try {
      setYamlPreview(renderCollectorYaml(graph));
    } catch (err) {
      setYamlPreviewError(err instanceof Error ? err.message : String(err));
      setYamlPreview("");
    }
  }, [graph]);
  const componentsByRole = useMemo(() => {
    const byRole: Record<PipelineComponentRole, PipelineGraph["components"]> = {
      receiver: [],
      processor: [],
      exporter: [],
    };
    for (const component of graph.components) {
      byRole[component.role].push(component);
    }
    return byRole;
  }, [graph]);

  const flow = useMemo(() => {
    const next = toFlow(graph);
    return { nodes: layoutLR(next.nodes, next.edges), edges: next.edges };
  }, [graph]);
  const [canvasState, setCanvasState] = useState<{
    nodes: BuilderNode[];
    edges: BuilderEdge[];
  }>(flow);
  useEffect(() => {
    setCanvasState(flow);
  }, [flow]);

  const guidanceRequest: AiGuidanceRequest = buildInsightRequest(
    insightSurface,
    [
      insightTarget(insightSurface, insightSurface.targets.page),
      insightTarget(insightSurface, insightSurface.targets.editor),
    ],
    {
      status: "prototype",
      draft_source: "in-memory example model",
      selected_mode: mode,
      selected_example: importResult ? IMPORTED_GRAPH_LABEL : graph.label,
      import_confidence: importResult?.confidence,
      import_warning_count: importResult?.warnings.length ?? 0,
      pipeline_summary: summarizePipelineGraph(graph),
      validation_ok: validation.ok,
      warnings: validation.warnings.map((item) => item.message),
      errors: validation.errors.map((item) => item.message),
    },
  );
  const guidance = usePortalGuidance(guidanceRequest);

  function handleImportYaml() {
    let result: CollectorYamlImportResult;
    try {
      result = parseCollectorYamlToGraph(yamlInput, {
        id: "builder-import",
        label: IMPORTED_GRAPH_LABEL,
      });
    } catch (error) {
      result = {
        graph: {
          id: "builder-import",
          label: IMPORTED_GRAPH_LABEL,
          components: [],
          wires: [],
        },
        confidence: "raw-only",
        warnings: [
          {
            code: "collector_yaml_import_error",
            message: `Collector YAML import failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        rawSections: {},
      };
    }
    setImportResult(result);
    setMode("split");
  }

  function handleExampleChange(nextExampleId: string | null) {
    if (!nextExampleId) return;
    setExampleId(nextExampleId);
    if (importResult) {
      setYamlInput("");
    }
    setImportResult(null);
  }

  function handleBackToExample() {
    setImportResult(null);
    setYamlInput("");
  }

  const exampleOptions =
    exampleEntries.length === 0
      ? [{ value: EMPTY_PIPELINE_GRAPH.id, label: "No examples configured" }]
      : exampleEntries.map(([id, example]) => ({ value: id, label: example.label }));

  const yamlPlaceholder = `receivers:
  otlp:
    protocols:
      grpc: {}
exporters:
  debug: {}
service:
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [debug]`;

  return (
    <PageShell width="wide">
      <PrototypeBanner message="Edits are in-memory only and YAML output is generated from the selected graph." />

      <PageHeader
        className="mt-6"
        title="Pipeline builder"
        description="Review Collector graph shape, generated YAML, and graph validation before draft saving is available."
      />

      <Group mt="md" gap="md" wrap="wrap" align="flex-end">
        <SegmentedControl
          value={mode}
          onChange={(value) => setMode(value as BuilderMode)}
          data={MODE_OPTIONS}
        />
        <Select
          label="Scenario"
          value={selectedExampleId}
          onChange={handleExampleChange}
          data={exampleOptions}
          allowDeselect={false}
        />
      </Group>

      <Card mt="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4} style={{ flex: 1 }}>
            <Title order={3} size="sm" fw={500}>
              Paste Collector YAML
            </Title>
            <Text size="sm" c="dimmed">
              Import a Collector config into the visual model and review anything that stays raw.
            </Text>
          </Stack>
          {importResult ? (
            <Badge color={importResult.confidence === "complete" ? "green" : "yellow"}>
              {importResult.confidence}
            </Badge>
          ) : (
            <Badge variant="default">optional</Badge>
          )}
        </Group>

        <Textarea
          mt="md"
          minRows={6}
          autosize
          value={yamlInput}
          onChange={(event) => setYamlInput(event.currentTarget.value)}
          placeholder={yamlPlaceholder}
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
        />

        <Group mt="sm" gap="xs">
          <Button onClick={handleImportYaml} disabled={yamlInput.trim().length === 0}>
            Import YAML
          </Button>
          {importResult ? (
            <Button variant="subtle" onClick={handleBackToExample}>
              Back to selected example
            </Button>
          ) : null}
        </Group>

        {importResult ? (
          <Stack mt="md" gap="xs">
            {importResult.warnings.length === 0 ? (
              <Alert color="green" variant="light" title="Import is fully visualized">
                Every imported section is represented in the graph.
              </Alert>
            ) : (
              importResult.warnings.map((warning, index) => (
                <Alert
                  key={`import-warning-${index}-${warning.code}`}
                  color="yellow"
                  variant="light"
                  title={`Import warning: ${warning.code}`}
                >
                  {warning.path ? `${warning.path}: ` : ""}
                  {warning.message}
                </Alert>
              ))
            )}

            {rawSectionEntries.length > 0 ? (
              <details>
                <summary>Preserved raw sections ({rawSectionEntries.length})</summary>
                <Code block mt="xs">
                  {JSON.stringify(importResult.rawSections, null, 2)}
                </Code>
              </details>
            ) : null}
          </Stack>
        ) : null}
      </Card>

      <SimpleGrid mt="md" cols={mode === "split" ? { base: 1, lg: 2 } : 1} spacing="md">
        {mode !== "yaml" ? (
          <Card>
            <Group justify="space-between" align="center">
              <Title order={3} size="sm" fw={500}>
                Visual graph
              </Title>
              <Badge color={validation.ok ? "green" : "red"}>
                {validation.ok ? "graph valid" : "graph issues"}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed" mt="xs">
              {summarizePipelineGraph(graph)}
            </Text>

            <Box mt="md">
              <Canvas
                nodes={canvasState.nodes}
                edges={canvasState.edges}
                onChange={setCanvasState}
                readOnly
                height={520}
              />
            </Box>

            <Group mt="md" gap="xs" aria-label="Component counts by role">
              {ROLES.map((role) => (
                <Badge key={role} variant="default">
                  {roleLabel(role)} ({componentsByRole[role].length})
                </Badge>
              ))}
            </Group>
          </Card>
        ) : null}

        {mode !== "visual" ? (
          <Card>
            <Group justify="space-between" align="center">
              <Title order={3} size="sm" fw={500}>
                Generated YAML
              </Title>
              <Group gap="xs">
                <Badge variant="default">artifact preview</Badge>
                {yamlPreview ? <CopyButton value={yamlPreview} label="copy YAML" /> : null}
              </Group>
            </Group>
            {yamlPreviewError !== null ? (
              <Alert mt="md" color="yellow" variant="light" title="YAML preview unavailable">
                {yamlPreviewError}
              </Alert>
            ) : (
              <Code block mt="md">
                {yamlPreview}
              </Code>
            )}
          </Card>
        ) : null}
      </SimpleGrid>

      <Card mt="md">
        <Title order={3} size="sm" fw={500}>
          Validation and rollout readiness
        </Title>
        <Text size="sm" c="dimmed" mt="xs">
          Graph checks run locally from the model. Collector runtime validation and rollout gates
          are separate backend contracts.
        </Text>

        <Stack mt="md" gap="xs">
          {yamlPreviewError !== null ? (
            <Alert color="red" variant="light" title="YAML preview unavailable">
              {yamlPreviewError}
            </Alert>
          ) : null}

          {yamlPreviewError === null &&
          validation.errors.length === 0 &&
          validation.warnings.length === 0 ? (
            <Alert color="green" variant="light" title="No graph issues detected">
              Review the generated YAML before creating a version.
            </Alert>
          ) : null}

          {validation.errors.map((issue, index) => (
            <Alert
              key={`error-${index}-${issue.code}`}
              color="red"
              variant="light"
              title={`Error: ${issue.code}`}
            >
              {issue.message}
            </Alert>
          ))}

          {validation.warnings.map((issue, index) => (
            <Alert
              key={`warning-${index}-${issue.code}`}
              color="yellow"
              variant="light"
              title={`Warning: ${issue.code}`}
            >
              {issue.message}
            </Alert>
          ))}
        </Stack>
      </Card>

      <GuidancePanel
        title="Builder next steps"
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
      />
    </PageShell>
  );
}
