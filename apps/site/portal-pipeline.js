/* =========================================================
   portal-pipeline.js
   Renders OTel collector pipelines as a horizontal flow:
   receivers → processors → exporters, with SVG connectors.
   Powers both the read-only visualizer (agent detail) and
   the editable builder (configurations -> builder).
   ========================================================= */
(function () {
  const SIG_ORDER = ["logs", "metrics", "traces"];

  // ---- OTel component catalog (subset) ----
  const CATALOG = {
    receivers: [
      {
        type: "otlp",
        desc: "OTLP gRPC + HTTP",
        signals: ["logs", "metrics", "traces"],
        fields: [
          { k: "protocols.grpc.endpoint", v: "0.0.0.0:4317" },
          { k: "protocols.http.endpoint", v: "0.0.0.0:4318" },
        ],
      },
      {
        type: "hostmetrics",
        desc: "Host CPU/mem/disk",
        signals: ["metrics"],
        fields: [
          { k: "collection_interval", v: "30s" },
          { k: "scrapers", v: "cpu, memory, disk, network, load" },
        ],
      },
      {
        type: "filelog",
        desc: "Log files",
        signals: ["logs"],
        fields: [
          { k: "include", v: "[/var/log/*.log]" },
          { k: "start_at", v: "end" },
        ],
      },
      {
        type: "kubeletstats",
        desc: "Kubelet metrics",
        signals: ["metrics"],
        fields: [
          { k: "collection_interval", v: "20s" },
          { k: "auth_type", v: "serviceAccount" },
        ],
      },
      {
        type: "prometheus",
        desc: "Prom scrape",
        signals: ["metrics"],
        fields: [
          { k: "config.scrape_configs[0].job_name", v: "app" },
          { k: "config.scrape_configs[0].static_configs[0].targets", v: "[localhost:9090]" },
        ],
      },
      {
        type: "k8s_events",
        desc: "K8s events as logs",
        signals: ["logs"],
        fields: [{ k: "namespaces", v: "[default, kube-system]" }],
      },
      {
        type: "jaeger",
        desc: "Jaeger traces",
        signals: ["traces"],
        fields: [{ k: "protocols.grpc.endpoint", v: "0.0.0.0:14250" }],
      },
    ],
    processors: [
      {
        type: "memory_limiter",
        desc: "Backpressure",
        signals: ["logs", "metrics", "traces"],
        fields: [
          { k: "check_interval", v: "1s" },
          { k: "limit_mib", v: "512" },
        ],
      },
      {
        type: "batch",
        desc: "Batch sends",
        signals: ["logs", "metrics", "traces"],
        fields: [
          { k: "send_batch_size", v: "8192" },
          { k: "timeout", v: "10s" },
        ],
      },
      {
        type: "k8sattributes",
        desc: "Enrich w/ K8s",
        signals: ["logs", "metrics", "traces"],
        fields: [
          { k: "extract.metadata", v: "[k8s.namespace.name, k8s.pod.name, k8s.deployment.name]" },
          { k: "passthrough", v: "false" },
        ],
      },
      {
        type: "resourcedetection",
        desc: "Add resource attrs",
        signals: ["logs", "metrics", "traces"],
        fields: [{ k: "detectors", v: "[env, system, ec2]" }],
      },
      {
        type: "attributes",
        desc: "Set / drop attrs",
        signals: ["logs", "metrics", "traces"],
        fields: [
          { k: "actions[0].key", v: "env" },
          { k: "actions[0].value", v: "production" },
          { k: "actions[0].action", v: "insert" },
        ],
      },
      {
        type: "filter",
        desc: "Drop by query",
        signals: ["logs", "metrics", "traces"],
        fields: [{ k: "logs.log_record", v: "[severity_number < SEVERITY_NUMBER_INFO]" }],
      },
      {
        type: "transform",
        desc: "OTTL transforms",
        signals: ["logs", "metrics", "traces"],
        fields: [
          { k: "log_statements[0].context", v: "log" },
          {
            k: "log_statements[0].statements",
            v: '[set(severity_text, "info") where severity_text == ""]',
          },
        ],
      },
      {
        type: "tail_sampling",
        desc: "Sample traces",
        signals: ["traces"],
        fields: [
          { k: "decision_wait", v: "10s" },
          { k: "policies[0].name", v: "errors" },
          { k: "policies[0].type", v: "status_code" },
        ],
      },
    ],
    exporters: [
      {
        type: "otlp",
        desc: "OTLP gRPC out",
        signals: ["logs", "metrics", "traces"],
        fields: [
          { k: "endpoint", v: "otelcol-gateway:4317" },
          { k: "tls.insecure", v: "true" },
        ],
      },
      {
        type: "otlphttp",
        desc: "OTLP HTTP out",
        signals: ["logs", "metrics", "traces"],
        fields: [
          { k: "endpoint", v: "https://api.honeycomb.io" },
          { k: "headers.x-honeycomb-team", v: "${HONEYCOMB_API_KEY}" },
        ],
      },
      {
        type: "prometheusremotewrite",
        desc: "Prom remote write",
        signals: ["metrics"],
        fields: [{ k: "endpoint", v: "https://prometheus.example.com/api/v1/write" }],
      },
      {
        type: "loki",
        desc: "Loki logs",
        signals: ["logs"],
        fields: [{ k: "endpoint", v: "https://logs-prod.grafana.net/loki/api/v1/push" }],
      },
      {
        type: "datadog",
        desc: "Datadog",
        signals: ["logs", "metrics", "traces"],
        fields: [
          { k: "api.site", v: "datadoghq.com" },
          { k: "api.key", v: "${DD_API_KEY}" },
        ],
      },
      {
        type: "splunk_hec",
        desc: "Splunk HEC",
        signals: ["logs", "metrics", "traces"],
        fields: [
          { k: "endpoint", v: "https://hec.example.com:8088/services/collector" },
          { k: "token", v: "${SPLUNK_HEC_TOKEN}" },
        ],
      },
      {
        type: "elasticsearch",
        desc: "Elasticsearch",
        signals: ["logs", "traces"],
        fields: [{ k: "endpoints", v: "[https://es.example.com:9200]" }],
      },
      {
        type: "debug",
        desc: "Stdout debug",
        signals: ["logs", "metrics", "traces"],
        fields: [{ k: "verbosity", v: "detailed" }],
      },
    ],
  };

  // ---- Example pipelines for the four agent shapes ----
  const EXAMPLES = {
    "edge-gateway": {
      label: "Edge gateway",
      desc: "Ingests OTLP from app fleet, batches, ships to backend.",
      receivers: [
        {
          id: "r1",
          type: "otlp",
          name: "otlp",
          signals: ["logs", "metrics", "traces"],
          cfg: {
            "protocols.grpc.endpoint": "0.0.0.0:4317",
            "protocols.http.endpoint": "0.0.0.0:4318",
          },
        },
      ],
      processors: [
        {
          id: "p1",
          type: "memory_limiter",
          name: "memory_limiter",
          signals: ["logs", "metrics", "traces"],
          cfg: { check_interval: "1s", limit_mib: "1024" },
        },
        {
          id: "p2",
          type: "attributes",
          name: "attributes/env",
          signals: ["logs", "metrics", "traces"],
          cfg: {
            "actions[0].key": "env",
            "actions[0].value": "production",
            "actions[0].action": "insert",
          },
        },
        {
          id: "p3",
          type: "batch",
          name: "batch",
          signals: ["logs", "metrics", "traces"],
          cfg: { send_batch_size: "8192", timeout: "10s" },
        },
      ],
      exporters: [
        {
          id: "e1",
          type: "otlp",
          name: "otlp/gateway",
          signals: ["logs", "metrics", "traces"],
          cfg: { endpoint: "otelcol-gateway:4317", "tls.insecure": "true" },
        },
      ],
      wires: [
        ["r1", "p1", "logs"],
        ["r1", "p1", "metrics"],
        ["r1", "p1", "traces"],
        ["p1", "p2", "logs"],
        ["p1", "p2", "metrics"],
        ["p1", "p2", "traces"],
        ["p2", "p3", "logs"],
        ["p2", "p3", "metrics"],
        ["p2", "p3", "traces"],
        ["p3", "e1", "logs"],
        ["p3", "e1", "metrics"],
        ["p3", "e1", "traces"],
      ],
    },
    "k8s-daemon": {
      label: "Kubernetes daemonset",
      desc: "Per-node: container logs + kubelet + k8s events. Routed to multiple backends.",
      receivers: [
        {
          id: "r1",
          type: "filelog",
          name: "filelog/containers",
          signals: ["logs"],
          cfg: { include: "[/var/log/pods/*/*/*.log]", start_at: "end" },
        },
        {
          id: "r2",
          type: "kubeletstats",
          name: "kubeletstats",
          signals: ["metrics"],
          cfg: { collection_interval: "20s", auth_type: "serviceAccount" },
        },
        {
          id: "r3",
          type: "k8s_events",
          name: "k8s_events",
          signals: ["logs"],
          cfg: { namespaces: "[]" },
        },
      ],
      processors: [
        {
          id: "p1",
          type: "k8sattributes",
          name: "k8sattributes",
          signals: ["logs", "metrics"],
          cfg: { "extract.metadata": "[k8s.namespace.name, k8s.pod.name, k8s.deployment.name]" },
        },
        {
          id: "p2",
          type: "resourcedetection",
          name: "resourcedetection",
          signals: ["logs", "metrics"],
          cfg: { detectors: "[env, system]" },
        },
        {
          id: "p3",
          type: "batch",
          name: "batch",
          signals: ["logs", "metrics"],
          cfg: { send_batch_size: "4096", timeout: "5s" },
        },
      ],
      exporters: [
        {
          id: "e1",
          type: "loki",
          name: "loki",
          signals: ["logs"],
          cfg: { endpoint: "https://logs-prod.grafana.net/loki/api/v1/push" },
        },
        {
          id: "e2",
          type: "prometheusremotewrite",
          name: "prometheusrw",
          signals: ["metrics"],
          cfg: { endpoint: "https://prom.example.com/api/v1/write" },
        },
      ],
      wires: [
        ["r1", "p1", "logs"],
        ["r2", "p1", "metrics"],
        ["r3", "p1", "logs"],
        ["p1", "p2", "logs"],
        ["p1", "p2", "metrics"],
        ["p2", "p3", "logs"],
        ["p2", "p3", "metrics"],
        ["p3", "e1", "logs"],
        ["p3", "e2", "metrics"],
      ],
    },
    "host-monitor": {
      label: "Host monitor (free tier)",
      desc: "Read-only host metrics → backend. No log/trace path.",
      receivers: [
        {
          id: "r1",
          type: "hostmetrics",
          name: "hostmetrics",
          signals: ["metrics"],
          cfg: {
            collection_interval: "30s",
            scrapers: "cpu, memory, disk, network, load, filesystem",
          },
        },
      ],
      processors: [
        {
          id: "p1",
          type: "resourcedetection",
          name: "resourcedetection",
          signals: ["metrics"],
          cfg: { detectors: "[env, system, ec2]" },
        },
        {
          id: "p2",
          type: "batch",
          name: "batch",
          signals: ["metrics"],
          cfg: { send_batch_size: "2048", timeout: "10s" },
        },
      ],
      exporters: [
        {
          id: "e1",
          type: "datadog",
          name: "datadog",
          signals: ["metrics"],
          cfg: { "api.site": "datadoghq.com", "api.key": "${DD_API_KEY}" },
        },
      ],
      wires: [
        ["r1", "p1", "metrics"],
        ["p1", "p2", "metrics"],
        ["p2", "e1", "metrics"],
      ],
    },
    "ingest-gateway": {
      label: "Ingest gateway (regional)",
      desc: "High-throughput aggregator. Tail samples traces, splits to multiple backends.",
      receivers: [
        {
          id: "r1",
          type: "otlp",
          name: "otlp",
          signals: ["logs", "metrics", "traces"],
          cfg: { "protocols.grpc.endpoint": "0.0.0.0:4317" },
        },
        {
          id: "r2",
          type: "jaeger",
          name: "jaeger",
          signals: ["traces"],
          cfg: { "protocols.grpc.endpoint": "0.0.0.0:14250" },
        },
      ],
      processors: [
        {
          id: "p1",
          type: "memory_limiter",
          name: "memory_limiter",
          signals: ["logs", "metrics", "traces"],
          cfg: { check_interval: "1s", limit_mib: "4096" },
        },
        {
          id: "p2",
          type: "tail_sampling",
          name: "tail_sampling",
          signals: ["traces"],
          cfg: {
            decision_wait: "10s",
            "policies[0].name": "errors",
            "policies[0].type": "status_code",
          },
        },
        {
          id: "p3",
          type: "transform",
          name: "transform/redact",
          signals: ["logs"],
          cfg: {
            "log_statements[0].context": "log",
            "log_statements[0].statements":
              '[replace_pattern(body, "(?i)password=[^ ]+", "password=***")]',
          },
        },
        {
          id: "p4",
          type: "batch",
          name: "batch",
          signals: ["logs", "metrics", "traces"],
          cfg: { send_batch_size: "16384", timeout: "5s" },
        },
      ],
      exporters: [
        {
          id: "e1",
          type: "splunk_hec",
          name: "splunk_hec",
          signals: ["logs"],
          cfg: { endpoint: "https://hec.example.com:8088/services/collector" },
        },
        {
          id: "e2",
          type: "prometheusremotewrite",
          name: "prometheusrw",
          signals: ["metrics"],
          cfg: { endpoint: "https://prom.example.com/api/v1/write" },
        },
        {
          id: "e3",
          type: "datadog",
          name: "datadog/traces",
          signals: ["traces"],
          cfg: { "api.site": "datadoghq.com", "api.key": "${DD_API_KEY}" },
        },
      ],
      wires: [
        ["r1", "p1", "logs"],
        ["r1", "p1", "metrics"],
        ["r1", "p1", "traces"],
        ["r2", "p1", "traces"],
        ["p1", "p3", "logs"],
        ["p1", "p4", "metrics"],
        ["p1", "p2", "traces"],
        ["p3", "p4", "logs"],
        ["p2", "p4", "traces"],
        ["p4", "e1", "logs"],
        ["p4", "e2", "metrics"],
        ["p4", "e3", "traces"],
      ],
    },
  };

  // ---- Insights (canned, contextual to a pipeline) ----
  const PIPELINE_INSIGHTS = {
    "edge-gateway": [
      {
        id: "i1",
        node: "p3",
        kind: "info",
        title: "Batch size could go higher",
        desc: "p99 batch fill is 31%. Bumping send_batch_size from 8192 → 16384 should reduce egress by ~12%.",
      },
    ],
    "k8s-daemon": [
      {
        id: "i1",
        node: "r3",
        kind: "warn",
        title: "k8s_events on all namespaces",
        desc: "Currently scoping to all namespaces (37). Limit to 4 active ones to drop log volume by ~80%.",
      },
      {
        id: "i2",
        node: "e2",
        kind: "err",
        title: "Remote write rejecting samples",
        desc: "2.3% of samples rejected for out-of-order timestamps in the last hour.",
      },
    ],
    "host-monitor": [],
    "ingest-gateway": [
      {
        id: "i1",
        node: "p2",
        kind: "info",
        title: "Tail-sampling head room",
        desc: "Current decision_wait=10s catches 94% of error spans. Dropping to 6s would barely change recall and free 1.2GB heap.",
      },
      {
        id: "i2",
        node: "p1",
        kind: "warn",
        title: "memory_limiter trips daily at 03:14",
        desc: "Spikes correlate with nightly batch jobs from cluster prod-east. Bumping limit_mib to 6144 stops drops.",
      },
    ],
  };

  // ---- Utility: SVG path between two DOM rectangles ----
  function pathBetween(a, b, container) {
    const cr = container.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const x1 = ar.right - cr.left;
    const y1 = ar.top + ar.height / 2 - cr.top;
    const x2 = br.left - cr.left;
    const y2 = br.top + br.height / 2 - cr.top;
    const dx = Math.max(40, (x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  // ---- Icon set for component types ----
  const ICONS = {
    receiver:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 8h7M7 5l3 3-3 3"/><circle cx="13" cy="8" r="1.5"/></svg>',
    processor:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="M6 8h4M8 6v4" stroke-linecap="round"/></svg>',
    exporter:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="3" cy="8" r="1.5"/><path d="M5 8h7M9 5l3 3-3 3"/></svg>',
  };

  function sigPill(s) {
    return `<span class="sig sig-${s}">${s.slice(0, 3)}</span>`;
  }

  function nodeHTML(n, role, hasInsight) {
    const sigs = (n.signals || []).map(sigPill).join("");
    const insightDot = hasInsight
      ? `<span class="insight ${hasInsight.kind}" title="${hasInsight.title}">!</span>`
      : "";
    const subtitle =
      n.type !== n.name ? n.type : CATALOG[role + "s"]?.find((c) => c.type === n.type)?.desc || "";
    return `
      <div class="pipe-node" data-id="${n.id}" data-role="${role}">
        ${insightDot}
        <div class="name"><span class="icon">${ICONS[role]}</span><span class="text">${n.name}</span></div>
        <div class="sub">${subtitle}</div>
        <div class="sig-row">${sigs}</div>
      </div>`;
  }

  function emptyHTML(role) {
    return `<div class="pipe-empty" data-role="${role}">+ add ${role}</div>`;
  }

  // Format a YAML snippet for one node's config (inspector)
  function nodeYaml(n) {
    const lines = [`<span class="k">${n.name}:</span>`];
    Object.entries(n.cfg || {}).forEach(([k, v]) => {
      // dotted keys nest; for snippet view, render flat with comments showing nesting depth
      const isList = String(v).startsWith("[");
      const isVar = String(v).startsWith("${");
      const cls = isList || isVar ? "s" : /^\d+$/.test(v) ? "n" : "s";
      lines.push(`  <span class="k">${k}:</span> <span class="${cls}">${v}</span>`);
    });
    return lines.join("\n");
  }

  // Render full pipeline YAML
  function pipelineYaml(model) {
    const out = [];
    out.push(`<span class="c"># Generated by O11yFleet pipeline builder</span>`);
    out.push(`<span class="k">receivers:</span>`);
    model.receivers.forEach((n) => {
      out.push(`  <span class="k">${n.name}:</span>`);
      Object.entries(n.cfg).forEach(([k, v]) =>
        out.push(`    <span class="k">${k}:</span> <span class="s">${v}</span>`),
      );
    });
    out.push(`<span class="k">processors:</span>`);
    model.processors.forEach((n) => {
      out.push(`  <span class="k">${n.name}:</span>`);
      Object.entries(n.cfg).forEach(([k, v]) =>
        out.push(`    <span class="k">${k}:</span> <span class="s">${v}</span>`),
      );
    });
    out.push(`<span class="k">exporters:</span>`);
    model.exporters.forEach((n) => {
      out.push(`  <span class="k">${n.name}:</span>`);
      Object.entries(n.cfg).forEach(([k, v]) =>
        out.push(`    <span class="k">${k}:</span> <span class="s">${v}</span>`),
      );
    });

    // Build service.pipelines from wires
    out.push(`<span class="k">service:</span>`);
    out.push(`  <span class="k">pipelines:</span>`);
    SIG_ORDER.forEach((sig) => {
      const recv = new Set(),
        proc = [],
        exp = new Set();
      // collect receivers feeding this signal (have wire from receiver into something with this sig)
      const sigWires = model.wires.filter((w) => w[2] === sig);
      if (sigWires.length === 0) return;
      sigWires.forEach(([from, to]) => {
        const fNode = findNode(model, from);
        const tNode = findNode(model, to);
        if (fNode?.role === "receiver") recv.add(fNode.name);
        if (tNode?.role === "exporter") exp.add(tNode.name);
        if (fNode?.role === "processor" && !proc.includes(fNode.name)) proc.push(fNode.name);
        if (tNode?.role === "processor" && !proc.includes(tNode.name)) proc.push(tNode.name);
      });
      if (recv.size === 0 || exp.size === 0) return;
      out.push(`    <span class="k">${sig}:</span>`);
      out.push(
        `      <span class="k">receivers:</span> <span class="s">[${[...recv].join(", ")}]</span>`,
      );
      if (proc.length)
        out.push(
          `      <span class="k">processors:</span> <span class="s">[${proc.join(", ")}]</span>`,
        );
      out.push(
        `      <span class="k">exporters:</span> <span class="s">[${[...exp].join(", ")}]</span>`,
      );
    });
    return out.join("\n");
  }

  function findNode(model, id) {
    for (const role of ["receiver", "processor", "exporter"]) {
      const n = model[role + "s"].find((x) => x.id === id);
      if (n) return Object.assign({}, n, { role });
    }
    return null;
  }

  // ---- Render a pipeline into a target element ----
  // opts: { editable: bool, onSelect, onChange, insights }
  function renderPipeline(host, model, opts = {}) {
    const editable = !!opts.editable;
    const insights = opts.insights || [];
    const insightByNode = {};
    insights.forEach((i) => {
      insightByNode[i.node] = i;
    });

    const recvHTML = model.receivers.length
      ? model.receivers.map((n) => nodeHTML(n, "receiver", insightByNode[n.id])).join("")
      : editable
        ? emptyHTML("receiver")
        : "";
    const procHTML = model.processors.length
      ? model.processors.map((n) => nodeHTML(n, "processor", insightByNode[n.id])).join("")
      : editable
        ? emptyHTML("processor")
        : "";
    const expHTML = model.exporters.length
      ? model.exporters.map((n) => nodeHTML(n, "exporter", insightByNode[n.id])).join("")
      : editable
        ? emptyHTML("exporter")
        : "";

    host.innerHTML = `
      <svg class="pipe-svg" preserveAspectRatio="none"></svg>
      <div class="pipe-col" data-role="receivers">
        <div class="pipe-col-head">Receivers <span class="count">${model.receivers.length}</span>${editable ? '<button class="add" data-add="receivers">+</button>' : ""}</div>
        ${recvHTML}
      </div>
      <div class="pipe-col" data-role="processors">
        <div class="pipe-col-head">Processors <span class="count">${model.processors.length}</span>${editable ? '<button class="add" data-add="processors">+</button>' : ""}</div>
        ${procHTML}
      </div>
      <div class="pipe-col" data-role="exporters">
        <div class="pipe-col-head">Exporters <span class="count">${model.exporters.length}</span>${editable ? '<button class="add" data-add="exporters">+</button>' : ""}</div>
        ${expHTML}
      </div>
    `;

    drawWires(host, model);

    // Click to select
    host.querySelectorAll(".pipe-node").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        host
          .querySelectorAll('.pipe-node[data-selected="1"]')
          .forEach((n) => n.removeAttribute("data-selected"));
        el.setAttribute("data-selected", "1");
        const id = el.getAttribute("data-id");
        const node = findNode(model, id);
        opts.onSelect && opts.onSelect(node, el);
      });
    });

    // Click on insight dot -> wire to onInsightClick
    host.querySelectorAll(".pipe-node .insight").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const nodeEl = el.closest(".pipe-node");
        const id = nodeEl.getAttribute("data-id");
        const insight = insightByNode[id];
        opts.onInsightClick && opts.onInsightClick(insight, nodeEl);
      });
    });

    // Builder-only behaviors
    if (editable) {
      host.querySelectorAll(".pipe-empty").forEach((el) => {
        el.addEventListener("click", () => {
          opts.onAdd && opts.onAdd(el.getAttribute("data-role").replace(/s$/, ""));
        });
      });
      host.querySelectorAll(".pipe-col-head .add").forEach((el) => {
        el.addEventListener("click", () => {
          opts.onAdd && opts.onAdd(el.getAttribute("data-add").replace(/s$/, ""));
        });
      });
      // Drag-drop from palette
      ["receivers", "processors", "exporters"].forEach((role) => {
        const col = host.querySelector(`.pipe-col[data-role="${role}"]`);
        col.addEventListener("dragover", (e) => {
          e.preventDefault();
          col.style.background = "color-mix(in oklab, var(--accent) 8%, transparent)";
        });
        col.addEventListener("dragleave", () => {
          col.style.background = "";
        });
        col.addEventListener("drop", (e) => {
          e.preventDefault();
          col.style.background = "";
          const data = e.dataTransfer.getData("application/x-pipe-component");
          if (!data) return;
          const parsed = JSON.parse(data);
          if (parsed.role + "s" !== role) {
            opts.onError &&
              opts.onError(`${parsed.type} is a ${parsed.role}, not a ${role.slice(0, -1)}`);
            return;
          }
          opts.onAdd && opts.onAdd(parsed.role, parsed.type);
        });
      });
    }

    return host;
  }

  function drawWires(host, model) {
    const svg = host.querySelector(".pipe-svg");
    if (!svg) return;
    // Size svg to host
    const r = host.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    svg.style.width = r.width + "px";
    svg.style.height = r.height + "px";
    let s = "";
    model.wires.forEach(([from, to, sig]) => {
      const fEl = host.querySelector(`.pipe-node[data-id="${from}"]`);
      const tEl = host.querySelector(`.pipe-node[data-id="${to}"]`);
      if (!fEl || !tEl) return;
      const d = pathBetween(fEl, tEl, host);
      s += `<path class="line ${sig} flow" data-wire="${from}|${to}|${sig}" d="${d}"/>`;
      s += `<path class="line-hit" data-wire="${from}|${to}|${sig}" d="${d}"/>`;
    });
    svg.innerHTML = s;
  }

  // Re-draw wires on resize
  function attachResizeRedraw(host, model) {
    const ro = new ResizeObserver(() => drawWires(host, model));
    ro.observe(host);
    return ro;
  }

  // Inspector renderer (read-only OR editable)
  function renderInspector(host, node, opts = {}) {
    if (!node) {
      host.innerHTML = `
        <div class="head"><div class="name" style="color: var(--fg-3); font-weight: 400;">No selection</div></div>
        <div class="body"><div style="font-size: 13px; color: var(--fg-3);">Click a node in the pipeline to inspect or edit its configuration.</div></div>`;
      return;
    }
    const editable = !!opts.editable;
    const fields = Object.entries(node.cfg || {});

    const fieldHTML = fields
      .map(
        ([k, v], i) => `
      <div class="field">
        <label>${k}</label>
        ${
          editable
            ? `<input value="${String(v).replace(/"/g, "&quot;")}" data-cfg-key="${k}" />`
            : `<input value="${String(v).replace(/"/g, "&quot;")}" disabled />`
        }
      </div>
    `,
      )
      .join("");

    const yaml = nodeYaml(node);

    host.innerHTML = `
      <div class="head">
        <div class="name">${node.name}</div>
        <span class="role">${node.role}</span>
      </div>
      <div class="body">
        ${
          editable
            ? `
        <div class="group">
          <div class="group-title">Identity</div>
          <div class="field">
            <label>name</label>
            <input value="${node.name}" data-cfg-name />
          </div>
          <div class="field">
            <label>type</label>
            <input value="${node.type}" disabled />
          </div>
        </div>`
            : ""
        }
        <div class="group">
          <div class="group-title">${editable ? "Configuration" : "Configuration (read-only)"}</div>
          ${fieldHTML || `<div style="font-size: 12.5px; color: var(--fg-3);">No configurable fields.</div>`}
        </div>
        <div class="group">
          <div class="group-title">YAML snippet</div>
          <div class="yaml-snippet">${yaml}</div>
        </div>
      </div>
      ${
        editable
          ? `
      <div class="foot">
        <button class="btn btn-secondary btn-sm" data-act="duplicate">Duplicate</button>
        <button class="btn btn-sm danger" data-act="delete">Delete</button>
      </div>`
          : ""
      }
    `;

    if (editable) {
      const nameEl = host.querySelector("[data-cfg-name]");
      nameEl?.addEventListener("input", () => opts.onRename && opts.onRename(nameEl.value));
      host.querySelectorAll("[data-cfg-key]").forEach((el) => {
        el.addEventListener(
          "input",
          () => opts.onCfgChange && opts.onCfgChange(el.getAttribute("data-cfg-key"), el.value),
        );
      });
      host
        .querySelector('[data-act="delete"]')
        ?.addEventListener("click", () => opts.onDelete && opts.onDelete());
      host
        .querySelector('[data-act="duplicate"]')
        ?.addEventListener("click", () => opts.onDuplicate && opts.onDuplicate());
    }
  }

  // Palette renderer (builder)
  function renderPalette(host) {
    const groupHTML = (role) => {
      const items = CATALOG[role + "s"];
      const pretty = role[0].toUpperCase() + role.slice(1) + "s";
      return `
        <div class="group-head">${pretty}</div>
        ${items
          .map(
            (it) => `
          <div class="item" draggable="true" data-role="${role}" data-type="${it.type}">
            <span class="icon">${ICONS[role]}</span>
            <span class="name">${it.type}</span>
            <span class="desc">${it.desc}</span>
          </div>`,
          )
          .join("")}`;
    };
    host.innerHTML = `
      <div class="head">
        <input placeholder="Filter components…" data-palette-search />
      </div>
      <div data-palette-list>
        ${groupHTML("receiver")}
        ${groupHTML("processor")}
        ${groupHTML("exporter")}
      </div>
    `;

    host.querySelectorAll(".item").forEach((el) => {
      el.addEventListener("dragstart", (e) => {
        const data = { role: el.getAttribute("data-role"), type: el.getAttribute("data-type") };
        e.dataTransfer.setData("application/x-pipe-component", JSON.stringify(data));
        el.classList.add("dragging");
      });
      el.addEventListener("dragend", () => el.classList.remove("dragging"));
    });

    const search = host.querySelector("[data-palette-search]");
    search?.addEventListener("input", () => {
      const q = search.value.toLowerCase().trim();
      host.querySelectorAll(".item").forEach((el) => {
        const t = el.getAttribute("data-type");
        const d = el.querySelector(".desc")?.textContent || "";
        el.style.display = !q || t.includes(q) || d.toLowerCase().includes(q) ? "" : "none";
      });
    });
  }

  // Helper: factory for a new node from catalog
  function newNode(role, type) {
    const item = CATALOG[role + "s"].find((x) => x.type === type);
    if (!item) return null;
    const id = role[0] + "_" + Math.random().toString(36).slice(2, 7);
    const cfg = {};
    item.fields.forEach((f) => (cfg[f.k] = f.v));
    return { id, type, name: type, signals: item.signals.slice(), cfg };
  }

  function newWiresAfterAdd(model, newNode, role) {
    // When a new node arrives, auto-wire it for any signal that already has a path lacking that node's role.
    // For receivers/exporters we just leave unwired; for processors we splice into existing flows.
    if (role !== "processor") return [];
    const wires = [];
    newNode.signals.forEach((sig) => {
      // Find last processor or first receiver feeding this sig
      // Simpler: connect from each receiver of this sig and from this node to each exporter of this sig
      // (only if there are no existing processor wires for this sig — keep auto-wiring conservative)
    });
    return wires;
  }

  window.OPipeline = {
    CATALOG,
    EXAMPLES,
    PIPELINE_INSIGHTS,
    renderPipeline,
    drawWires,
    attachResizeRedraw,
    renderInspector,
    renderPalette,
    pipelineYaml,
    findNode,
    newNode,
  };
})();
