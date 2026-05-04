import { Link } from "react-router";

const rows = [
  {
    title: "Version every change",
    desc: "Each YAML upload is stored as an immutable snapshot with a content hash. Track the evolution of your pipeline.",
  },
  {
    title: "Immediate rollouts",
    desc: "Push the current config to connected collectors instantly across any environment. Stop waiting for slow CM tools.",
  },
  {
    title: "Real-time drift detection",
    desc: "Collectors report their effective configuration via OpAMP. Spot manual overrides or out-of-sync agents instantly.",
  },
];

const steps = ["Upload Config", "Review Drift", "Deploy", "Monitor Health"];

const visuals = [
  [{ text: "collector-prod.yaml" }, { text: "sha256:4f8c…9e1a" }, { text: "Updated 2m ago" }],
  [
    { text: "Rollout target: 84 collectors" },
    { text: "Safe rollback ready" },
    { text: "Status: Ready" },
  ],
  [
    { text: "Connected collectors: 82/84" },
    { text: "Drift detected: 2", warning: true },
    { text: "Last report: 34s ago" },
  ],
];

export default function ProductConfigPage() {
  return (
    <>
      <section className="hero wrap">
        <div className="hero-meta">
          <span className="pin">Product</span>
        </div>
        <h1>
          Configuration management
          <br /> that doesn't break prod
        </h1>
        <p className="lede">
          Move beyond manual SSH and scattered YAML. Versioned configs, immediate rollouts, and
          real-time effective config visibility.
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
                  {(visuals[i] ?? []).map((item) => (
                    <div
                      key={item.text}
                      style={{
                        border: "1px solid var(--border, #e2e2e2)",
                        borderRadius: 8,
                        padding: "10px 12px",
                        fontFamily: "var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
                        fontSize: "0.9rem",
                        color: item.warning ? "var(--warn)" : undefined,
                      }}
                    >
                      {item.text}
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
            <span className="eyebrow">How it works</span>
          </div>
          <div className="grid-4">
            {steps.map((step, i) => (
              <div key={step} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div className="card card-pad" style={{ flex: 1, textAlign: "center" }}>
                  <strong>
                    {i + 1}. {step}
                  </strong>
                </div>
                {i < steps.length - 1 && (
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
            <h2>Stop guessing what's deployed.</h2>
            <p className="lede">
              Start with visibility, verify your edge configurations, then take over management when
              you're ready.
            </p>
            <div className="hero-actions">
              <Link to="/signup" className="btn btn-primary btn-lg">
                Request access →
              </Link>
              <Link to="/pricing" className="btn btn-secondary btn-lg">
                See pricing
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
