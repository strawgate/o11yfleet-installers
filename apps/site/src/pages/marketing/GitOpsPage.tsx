import { Link } from "react-router-dom";

const rows = [
  {
    title: "Commit-driven rollouts",
    desc: "Push to main, configs deploy. Branch protection and codeowners apply.",
  },
  {
    title: "PR-based review",
    desc: "See the collector config diff in your PR. Approve with context.",
  },
  {
    title: "Automatic drift remediation",
    desc: "If a collector drifts from the repo state, it self-corrects on next sync.",
  },
];

const pipeline = ["Commit", "Sync", "Validate", "Deploy"];

export default function GitOpsPage() {
  return (
    <>
      <section className="hero wrap">
        <div className="hero-meta">
          <span className="pin">Solutions</span>
        </div>
        <h1>
          GitOps for
          <br />
          collector configuration
        </h1>
        <p className="lede">
          Commit to your repo, watch configs roll out. Branch protection, PR review, and audit trail
          — the workflow you already know.
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
                style={{
                  direction: "ltr",
                  minHeight: 180,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--muted, #888)",
                }}
              >
                [illustration]
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
              Connect your GitHub repo and let configs flow from commit to collector.
            </p>
            <div className="hero-actions">
              <Link to="/signup" className="btn btn-primary btn-lg">
                Start free →
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
