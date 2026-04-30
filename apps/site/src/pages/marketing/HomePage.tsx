import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <>
      <section className="hero wrap">
        <h1>Free for up to 1000 OTel Collectors</h1>
        <p className="lede" style={{ marginTop: 22 }}>
          Connect collectors, see health and effective configuration, and roll out changes from one
          hosted control plane. O11yFleet stays free until production requirements like history,
          rollout safety, and governance become real.
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
              <h3>Fleet visibility</h3>
              <p>
                See connected collectors, heartbeat status, and the effective config each collector
                is actually running.
              </p>
            </div>
            <div className="card card-pad">
              <h3>Management policies</h3>
              <p>
                Group collectors by policy, keep configuration versions, compare changes, and roll
                back when needed.
              </p>
            </div>
            <div className="card card-pad">
              <h3>Safer rollouts</h3>
              <p>
                Push collector changes intentionally, watch the fleet respond, and keep rollback
                close when production is on the line.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Why it matters</span>
            <h2>OpenTelemetry is open. Collector operations should be too.</h2>
          </div>
          <div className="grid-3">
            <div className="card card-pad">
              <h3>Start with inventory</h3>
              <p>
                Most teams just need to know which collectors are connected and what they are
                running.
              </p>
            </div>
            <div className="card card-pad">
              <h3>Invite the team</h3>
              <p>
                Starter includes 1,000 collectors and 3 users, so shared visibility does not require
                a sales call.
              </p>
            </div>
            <div className="card card-pad">
              <h3>Upgrade for governance</h3>
              <p>
                Growth adds more management policies, 30-day history, repo sync, API keys, RBAC, and
                audit.
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
              safety, team controls, or governance.
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
