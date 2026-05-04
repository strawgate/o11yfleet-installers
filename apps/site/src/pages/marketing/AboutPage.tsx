import { Link } from "react-router";

export default function AboutPage() {
  return (
    <>
      <section className="hero wrap">
        <div className="hero-meta">
          <span className="pin">About</span>
        </div>
        <h1>
          OpenTelemetry is open.
          <br /> Collector management should be too.
        </h1>
        <div className="about-lede-grid">
          <p className="lede">
            The OpenTelemetry Collector has become the industry standard way to receive, process,
            and route telemetry. But the operational experience around managing these fleets at
            scale is still too manual.
          </p>
          <p className="lede">
            Teams end up with scattered YAML, unclear rollout history, and limited visibility into
            what is actually running. We built a vendor-neutral OpAMP control plane so teams can
            manage their fleets with confidence — without locking their data into a proprietary
            pipeline.
          </p>
        </div>
      </section>

      <section className="section section-tight">
        <div className="wrap">
          <div className="about-manifesto-grid">
            <div>
              <span className="eyebrow">Manifesto</span>
            </div>
            <blockquote style={{ fontSize: "1.5rem", lineHeight: 1.5, margin: 0 }}>
              Telemetry should be portable. Configuration should be auditable. Adoption should be
              incremental. We are not trying to become another required destination — we are
              building the control plane that makes OpenTelemetry feel operable.
            </blockquote>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">What we believe</span>
          </div>
          <div className="about-beliefs-grid">
            {[
              {
                title: "Open standards over proprietary agents",
                desc: "Built natively on OpAMP and OpenTelemetry. We don't deploy bespoke, black-box agents.",
              },
              {
                title: "Control without lock-in",
                desc: "Your telemetry goes wherever you point it. We manage the fleet, we don't hold the data.",
              },
              {
                title: "Massive Free Tier",
                desc: "Start with visibility for up to 1,000 collectors. Upgrade when enterprise governance becomes a mandate.",
              },
              {
                title: "Cost Control at the Edge",
                desc: "Reduce backend ingestion costs by confidently filtering and sampling telemetry at the collector.",
              },
              {
                title: "Transparent, Predictable Pricing",
                desc: "Pay for management seats, not data volume. No per-GB ingestion surprises.",
              },
              {
                title: "Safer Rollouts",
                desc: "Rollouts should be explicit, versioned, and instantly reversible.",
              },
            ].map((v) => (
              <div key={v.title} className="about-belief-card">
                <h3>{v.title}</h3>
                <p>{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="cta-block">
            <h2>Want to follow along?</h2>
            <p className="lede">
              We share progress in the open. Star the repo, join the community, or just keep an eye
              on the changelog.
            </p>
            <div className="hero-actions">
              <Link to="/signup" className="btn btn-primary btn-lg">
                Request access →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
