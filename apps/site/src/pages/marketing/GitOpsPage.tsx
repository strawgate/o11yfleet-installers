import { Link } from "react-router-dom";

const rows = [
  {
    title: "Infrastructure as Code",
    desc: "Your repository is the source of truth. Manage observability pipelines with the same rigorous peer review you use for your application code.",
  },
  {
    title: "Keep PR review in your process",
    desc: "While native sync is in development, review collector YAML in your repo, merge with confidence, and upload the approved artifact.",
  },
  {
    title: "Explicit Promotion",
    desc: "Upload known-good YAML and trigger a deliberate, monitored rollout when you are ready to update the fleet.",
  },
];

const pipeline = ["Commit", "Review", "Upload", "Roll out"];

const visuals = [
  ["Roadmap: Native Git sync", "Status: In Development", "Current: UI + CLI upload"],
  ["Pull request approved", "CI checks: passing", "Artifact ready"],
  ["Source: main branch", "Version: 2026-04-30.1", "Rollout: Explicit trigger"],
];

export default function GitOpsPage() {
  return (
    <>
      <section className="hero wrap">
        <div className="hero-meta">
          <span className="pin">Solutions</span>
        </div>
        <h1>
          GitOps for
          <br /> OpenTelemetry
        </h1>
        <p className="lede">
          Treat your telemetry pipelines like production infrastructure. Keep collector
          configurations in version control and roll out with confidence.
        </p>
      </section>

      <section className="section">
        <div className="wrap">
          {rows.map((row, i) => (
            <div
              key={row.title}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 64,
                alignItems: "center",
                padding: "64px 0",
                borderBottom: i < rows.length - 1 ? "1px solid var(--border, #e2e2e2)" : undefined,
                direction: i % 2 === 1 ? "rtl" : undefined,
              }}
            >
              <div style={{ direction: "ltr" }}>
                <h2>{row.title}</h2>
                <p className="lede">{row.desc}</p>
              </div>
              <div
                className="card card-pad"
                style={{ direction: "ltr", minHeight: 180 }}
                aria-label="Example illustration"
              >
                <div style={{ display: "grid", gap: 10 }}>
                  <span
                    className="eyebrow"
                    style={{ fontSize: "0.7rem", color: "var(--muted, #888)" }}
                  >
                    Example
                  </span>
                  {(visuals[i] ?? []).map((line) => (
                    <div
                      key={line}
                      style={{
                        border: "1px solid var(--border, #e2e2e2)",
                        borderRadius: 8,
                        padding: "10px 12px",
                        fontFamily: "var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
                        fontSize: "0.9rem",
                      }}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Pipeline</span>
          </div>
          <div className="grid-4">
            {pipeline.map((step, i) => (
              <div key={step} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div className="card card-pad" style={{ flex: 1, textAlign: "center" }}>
                  <strong>
                    {i + 1}. {step}
                  </strong>
                </div>
                {i < pipeline.length - 1 && (
                  <span style={{ fontSize: "1.5rem", color: "var(--muted, #888)" }}>→</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="cta-block">
            <h2>Your repo is the source of truth.</h2>
            <p className="lede">
              Use your repo for review today, and follow the roadmap toward native Git-backed
              synchronization.
            </p>
            <div className="hero-actions">
              <Link to="/signup" className="btn btn-primary btn-lg">
                Request access →
              </Link>
              <Link to="/product/configuration-management" className="btn btn-secondary btn-lg">
                Learn about config management
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
