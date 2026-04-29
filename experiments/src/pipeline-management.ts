import {
  PIPELINE_EXAMPLES,
  renderCollectorYaml,
  summarizePipelineGraph,
  validatePipelineGraph,
  type PipelineGraph,
} from "@o11yfleet/core/pipeline";

function cloneGraph(graph: PipelineGraph): PipelineGraph {
  return JSON.parse(JSON.stringify(graph)) as PipelineGraph;
}

function printValidation(label: string, graph: PipelineGraph): void {
  const validation = validatePipelineGraph(graph);
  console.log(`\n${label}`);
  console.log("-".repeat(label.length));
  console.log(summarizePipelineGraph(graph));
  console.log(`valid: ${validation.ok}`);
  if (validation.errors.length > 0) {
    console.log("errors:");
    for (const error of validation.errors) {
      console.log(`  - ${error.code}: ${error.message}`);
    }
  }
  if (validation.warnings.length > 0) {
    console.log("warnings:");
    for (const warning of validation.warnings) {
      console.log(`  - ${warning.code}: ${warning.message}`);
    }
  }
}

const edgeGateway = PIPELINE_EXAMPLES["edge-gateway"]!;
const hostMonitor = PIPELINE_EXAMPLES["host-monitor"]!;

console.log("Pipeline management experiments");
console.log("===============================\n");

console.log("Experiment 1: graph model -> generated collector YAML");
console.log(
  "Goal: prove the visual builder can own a graph model and still emit reviewable YAML.\n",
);
console.log(renderCollectorYaml(edgeGateway));

printValidation("Experiment 2: validation catches impossible wiring", {
  ...cloneGraph(hostMonitor),
  wires: [{ from: "e1", to: "r1", signal: "metrics" }],
});

console.log("\nExperiment notes");
console.log("----------------");
console.log("- A graph-first model can support visual builder, agent visualizer, and YAML output.");
console.log("- Dotted and indexed config paths must be expanded before YAML generation.");
console.log(
  "- Real OTel validation still needs collector-aware schema checks after this foundation.",
);
