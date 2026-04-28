import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <>
      <section className="hero wrap">
        <div className="hero-meta">
          <span className="pin">
            <span className="dot dot-ok dot-pulse" /> OpAMP-native · v0.42
          </span>
        </div>
        <h1>
          The hosted OpAMP control plane
          <br />
          for OpenTelemetry Collectors
        </h1>
        <p className="lede" style={{ marginTop: 22 }}>
          Monitor collector health, inspect effective configs, upload managed configs, and trigger
          rollouts — while your telemetry keeps flowing to the tools you already use.
        </p>
        <div className="hero-actions">
          <Link to="/signup" className="btn btn-primary btn-lg">
            Request access →
          </Link>
          <a href="#how" className="btn btn-secondary btn-lg">
            See how it works
          </a>
        </div>
        <div className="trust-strip">
          <span>No telemetry lock-in</span>
          <span>UI-managed configurations today</span>
          <span>Hosted access by request</span>
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">What you get</span>
            <h2>Everything between commit and collector</h2>
          </div>
          <div className="grid-3">
            <div className="card card-pad">
              <h3>Configuration management</h3>
              <p>Version, diff, and roll out collector configs.</p>
            </div>
            <div className="card card-pad">
              <h3>Fleet monitoring</h3>
              <p>Real-time health, heartbeats, and effective config inspection.</p>
            </div>
            <div className="card card-pad">
              <h3>Multi-tenant</h3>
              <p>Isolate teams, projects, or environments in one control plane.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="cta-block">
            <h2>Stop hand-editing YAML on 200&nbsp;servers.</h2>
            <p className="lede">
              Start locally in minutes, or request hosted access when you are ready to connect real
              collectors.
            </p>
            <div className="hero-actions">
              <Link to="/signup" className="btn btn-primary btn-lg">
                Request access →
              </Link>
              <a href="/docs/index.html" className="btn btn-secondary btn-lg">
                Read the docs
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
