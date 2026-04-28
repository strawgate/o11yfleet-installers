import { Link } from "react-router-dom";

const rows = [
  {
    title: "Version every change",
    desc: "Configs are immutable snapshots. Diff any two versions, roll back instantly.",
  },
  {
    title: "Label-targeted rollouts",
    desc: "Roll changes to specific label sets. Canary, then promote.",
  },
  {
    title: "Drift detection",
    desc: "Know when what's running doesn't match what you intended.",
  },
];

const steps = ["Edit", "Review", "Roll out", "Monitor"];

export default function ProductConfigPage() {
  return (
    <>
      <section className="hero wrap">
        <div className="hero-meta">
          <span className="pin">Product</span>
        </div>
        <h1>
          Configuration management
          <br />
          that doesn't break prod
        </h1>
        <p className="lede">
          Versioned configs, label-targeted rollouts, and automatic drift detection — so you can
          ship changes without holding your breath.
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
              Start with visibility, then take over config management when you're ready.
            </p>
            <div className="hero-actions">
              <Link to="/signup" className="btn btn-primary btn-lg">
                Start free →
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
