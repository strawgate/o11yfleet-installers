import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Group,
  Modal,
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
import { useSavePipeline } from "../../api/hooks/portal";
import { GuidancePanel } from "../../components/ai";
import { buildInsightRequest, insightSurfaces, insightTarget } from "../../ai/insight-registry";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";
import { notifications } from "@mantine/notifications";
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
  ValidationStrip,
  layoutLR,
  toFlow,
  type BuilderNode,
} from "@/components/pipeline-builder";
import { AddComponentPanel } from "../../components/pipeline-builder/nodes/AddComponentPanel";
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
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [isAddPanelOpen, setIsAddPanelOpen] = useState(false);
  const savePipeline = useSavePipeline();

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
  const validationResult = useMemo(() => validatePipelineGraph(graph), [graph]);
  const validation = useMemo(
    () => ({
      ok: validationResult.ok,
      canSave: validationResult.ok,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
    }),
    [validationResult],
  );
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

  function handleDiscardChanges() {
    handleBackToExample();
  }

  function handleAddNode(newNode: BuilderNode) {
    const newComponent = {
      id: newNode.id,
      role: newNode.type as PipelineComponentRole,
      type: newNode.data.name,
      name: newNode.data.name,
      signals: [...newNode.data.signals],
      config: {},
    };
    setImportResult({
      graph: { ...graph, components: [...graph.components, newComponent] },
      confidence: "complete",
      warnings: [],
      rawSections: {},
    });
  }

  async function handleSavePipeline() {
    if (!yamlPreview) return;
    try {
      await savePipeline.mutateAsync(yamlPreview);
      setSaveModalOpen(false);
      notifications.show({
        title: "Pipeline preview generated",
        message: "Saving pipelines is not yet wired to the backend. Copy the YAML below to apply.",
        color: "yellow",
      });
    } catch (error) {
      notifications.show({
        title: "Failed to generate preview",
        message: error instanceof Error ? error.message : "Unknown error",
        color: "red",
      });
    }
  }

  const exampleOptions =
    exampleEntries.length === 0
      ? [{ value: EMPTY_PIPELINE_GRAPH.id, label: "No examples configured" }]
      : exampleEntries.map(([id, example]) => ({ value: id, label: example.label }));

  return (
    <PageShell width="wide">
      <PrototypeBanner message="Edits are in-memory only and YAML output is generated from the selected graph." />

      <PageHeader
        className="mt-6"
        title="Pipeline builder"
        description="Review Collector graph shape, generated YAML, and graph validation before draft saving is available."
        actions={
          <>
            <Button variant="default" onClick={() => setIsAddPanelOpen(true)}>
              Add node
            </Button>
            <Button variant="default" onClick={handleDiscardChanges}>
              Discard changes
            </Button>
            <Button
              onClick={() => setSaveModalOpen(true)}
              disabled={!validation.ok || yamlPreviewError !== null}
            >
              Review YAML export
            </Button>
          </>
        }
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
          placeholder={`receivers:
  otlp:
    protocols:
      grpc: {}
exporters:
  debug: {}
service:
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [debug]`}
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
              <Canvas nodes={flow.nodes} edges={flow.edges} readOnly height={520} />
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

      <ValidationStrip validation={validation} yamlPreviewError={yamlPreviewError} />

      <GuidancePanel
        title="Builder next steps"
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
      />

      <Modal
        opened={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Review YAML export"
      >
        <Stack gap="md">
          <Text size="sm">
            Saving pipelines is not yet wired to the backend. Review and copy the generated YAML
            below if you want to apply it manually.
          </Text>
          <Group gap="xs" justify="flex-end">
            <Button variant="default" onClick={() => setSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSavePipeline()} loading={savePipeline.isPending}>
              Continue
            </Button>
          </Group>
        </Stack>
      </Modal>

      <AddComponentPanel
        opened={isAddPanelOpen}
        onClose={() => setIsAddPanelOpen(false)}
        onAddNode={handleAddNode}
        existingNodes={flow.nodes}
      />
    </PageShell>
  );
}
