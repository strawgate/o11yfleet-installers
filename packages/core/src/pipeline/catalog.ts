import type { PipelineCatalogItem, PipelineGraph } from "./types.js";

export const PIPELINE_COMPONENT_CATALOG: PipelineCatalogItem[] = [
  {
    role: "receiver",
    type: "otlp",
    description: "OTLP gRPC and HTTP ingress",
    signals: ["logs", "metrics", "traces"],
    defaults: {
      "protocols.grpc.endpoint": "0.0.0.0:4317",
      "protocols.http.endpoint": "0.0.0.0:4318",
    },
  },
  {
    role: "receiver",
    type: "hostmetrics",
    description: "Host CPU, memory, disk, and network metrics",
    signals: ["metrics"],
    defaults: {
      collection_interval: "30s",
      scrapers: ["cpu", "memory", "disk", "network", "load"],
    },
  },
  {
    role: "receiver",
    type: "filelog",
    description: "Tail local log files",
    signals: ["logs"],
    defaults: {
      include: ["/var/log/*.log"],
      start_at: "end",
    },
  },
  {
    role: "processor",
    type: "memory_limiter",
    description: "Apply backpressure before the collector runs out of memory",
    signals: ["logs", "metrics", "traces"],
    defaults: {
      check_interval: "1s",
      limit_mib: 512,
    },
  },
  {
    role: "processor",
    type: "batch",
    description: "Batch telemetry before export",
    signals: ["logs", "metrics", "traces"],
    defaults: {
      send_batch_size: 8192,
      timeout: "10s",
    },
  },
  {
    role: "processor",
    type: "attributes",
    description: "Insert, update, or delete telemetry attributes",
    signals: ["logs", "metrics", "traces"],
    defaults: {
      "actions[0].key": "env",
      "actions[0].value": "production",
      "actions[0].action": "insert",
    },
  },
  {
    role: "processor",
    type: "tail_sampling",
    description: "Sample traces after observing whole trace shape",
    signals: ["traces"],
    defaults: {
      decision_wait: "10s",
      "policies[0].name": "errors",
      "policies[0].type": "status_code",
    },
  },
  {
    role: "exporter",
    type: "otlp",
    description: "OTLP gRPC export",
    signals: ["logs", "metrics", "traces"],
    defaults: {
      endpoint: "otelcol-gateway:4317",
      "tls.insecure": true,
    },
  },
  {
    role: "exporter",
    type: "otlphttp",
    description: "OTLP HTTP export",
    signals: ["logs", "metrics", "traces"],
    defaults: {
      endpoint: "https://api.honeycomb.io",
      "headers.x-honeycomb-team": "$" + "{HONEYCOMB_API_KEY}",
    },
  },
  {
    role: "exporter",
    type: "prometheusremotewrite",
    description: "Prometheus remote write export",
    signals: ["metrics"],
    defaults: {
      endpoint: "https://prometheus.example.com/api/v1/write",
    },
  },
];

export const PIPELINE_EXAMPLES: Record<string, PipelineGraph> = {
  "edge-gateway": {
    id: "edge-gateway",
    label: "Edge gateway",
    description:
      "Ingests OTLP from an app fleet, adds production attributes, and exports upstream.",
    components: [
      {
        id: "r1",
        role: "receiver",
        type: "otlp",
        name: "otlp",
        signals: ["logs", "metrics", "traces"],
        config: {
          "protocols.grpc.endpoint": "0.0.0.0:4317",
          "protocols.http.endpoint": "0.0.0.0:4318",
        },
      },
      {
        id: "p1",
        role: "processor",
        type: "memory_limiter",
        name: "memory_limiter",
        signals: ["logs", "metrics", "traces"],
        config: { check_interval: "1s", limit_mib: 1024 },
      },
      {
        id: "p2",
        role: "processor",
        type: "attributes",
        name: "attributes/env",
        signals: ["logs", "metrics", "traces"],
        config: {
          "actions[0].key": "env",
          "actions[0].value": "production",
          "actions[0].action": "insert",
        },
      },
      {
        id: "p3",
        role: "processor",
        type: "batch",
        name: "batch",
        signals: ["logs", "metrics", "traces"],
        config: { send_batch_size: 8192, timeout: "10s" },
      },
      {
        id: "e1",
        role: "exporter",
        type: "otlp",
        name: "otlp/gateway",
        signals: ["logs", "metrics", "traces"],
        config: { endpoint: "otelcol-gateway:4317", "tls.insecure": true },
      },
    ],
    wires: [
      { from: "r1", to: "p1", signal: "logs" },
      { from: "r1", to: "p1", signal: "metrics" },
      { from: "r1", to: "p1", signal: "traces" },
      { from: "p1", to: "p2", signal: "logs" },
      { from: "p1", to: "p2", signal: "metrics" },
      { from: "p1", to: "p2", signal: "traces" },
      { from: "p2", to: "p3", signal: "logs" },
      { from: "p2", to: "p3", signal: "metrics" },
      { from: "p2", to: "p3", signal: "traces" },
      { from: "p3", to: "e1", signal: "logs" },
      { from: "p3", to: "e1", signal: "metrics" },
      { from: "p3", to: "e1", signal: "traces" },
    ],
  },
  "host-monitor": {
    id: "host-monitor",
    label: "Host monitor",
    description: "Collects host metrics and exports them to a metrics backend.",
    components: [
      {
        id: "r1",
        role: "receiver",
        type: "hostmetrics",
        name: "hostmetrics",
        signals: ["metrics"],
        config: {
          collection_interval: "30s",
          scrapers: ["cpu", "memory", "disk", "network", "load"],
        },
      },
      {
        id: "p1",
        role: "processor",
        type: "batch",
        name: "batch",
        signals: ["metrics"],
        config: { send_batch_size: 2048, timeout: "10s" },
      },
      {
        id: "e1",
        role: "exporter",
        type: "prometheusremotewrite",
        name: "prometheusrw",
        signals: ["metrics"],
        config: { endpoint: "https://prom.example.com/api/v1/write" },
      },
    ],
    wires: [
      { from: "r1", to: "p1", signal: "metrics" },
      { from: "p1", to: "e1", signal: "metrics" },
    ],
  },
};
