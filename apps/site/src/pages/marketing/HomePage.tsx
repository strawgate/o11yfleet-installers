import { Link } from "react-router";

export default function HomePage() {
  return (
    <>
      <section className="hero wrap">
        <h1>The OpenTelemetry Control Plane.</h1>
        <p className="hero-subheadline">Free for up to 1,000 OTel Collectors.</p>
        <p className="lede" style={{ marginTop: 22 }}>
          We don't want your data. We want your telemetry pipelines to work. Connect collectors,
          monitor health, and confidently roll out configurations from one vendor-neutral OpAMP
          control plane. Start with visibility and scale with governance.
        </p>
        <div className="hero-actions">
          <Link to="/signup" className="btn btn-primary btn-lg">
            Request access →
          </Link>
          <Link to="/pricing" className="btn btn-secondary btn-lg">
            See pricing
          </Link>
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Control plane</span>
            <h2>Monitor first. Manage when ready.</h2>
          </div>
          <div className="grid-3">
            <div className="card card-pad">
              <div aria-hidden="true" style={{ fontSize: "2rem", marginBottom: 12 }}>
                📡
              </div>
              <h3>Vendor-Neutral Visibility</h3>
              <p>
                See connected collectors across any environment, monitor heartbeat status, and
                detect config drift in real-time. We manage the fleet, not the data.
              </p>
            </div>
            <div className="card card-pad">
              <div aria-hidden="true" style={{ fontSize: "2rem", marginBottom: 12 }}>
                🛠️
              </div>
              <h3>Safer Rollouts</h3>
              <p>
                Push collector changes intentionally. Group collectors by configuration, watch the
                fleet respond, and roll back instantly if production is on the line.
              </p>
            </div>
            <div className="card card-pad">
              <div aria-hidden="true" style={{ fontSize: "2rem", marginBottom: 12 }}>
                💸
              </div>
              <h3>Cost Control at the Edge</h3>
              <p>
                Filter, deduplicate, and sample telemetry at the source. Stop blowing your Datadog
                or Splunk budget on low-value data.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Why it matters</span>
            <h2>Open standards over proprietary agents.</h2>
          </div>
          <div className="grid-3">
            <div className="card card-pad">
              <h3>Pure-Play OpAMP</h3>
              <p>
                Built natively on the Open Agent Management Protocol. No bespoke agents to deploy,
                and zero proprietary lock-in.
              </p>
            </div>
            <div className="card card-pad">
              <h3>Massive Free Tier</h3>
              <p>
                Our Starter plan includes 1,000 collectors and 3 users. Shared visibility shouldn't
                require a sales call or a massive budget.
              </p>
            </div>
            <div className="card card-pad">
              <h3>Built for Governance</h3>
              <p>
                Upgrade to Growth or Enterprise for deep management policies, SSO, strict RBAC,
                extended history, and compliance audit trails.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="cta-block">
            <h2>Start with fleet visibility.</h2>
            <p className="lede">
              Connect collectors for free, then upgrade when production needs history, rollout
              safety, team controls, or enterprise governance.
            </p>
            <div className="hero-actions">
              <Link to="/signup" className="btn btn-primary btn-lg">
                Request access →
              </Link>
              <Link to="/pricing" className="btn btn-secondary btn-lg">
                Compare plans
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
