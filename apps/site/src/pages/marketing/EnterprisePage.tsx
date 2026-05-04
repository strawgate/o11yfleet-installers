import { Link } from "react-router-dom";

const features = [
  {
    icon: "🔐",
    title: "SSO & SAML Integration",
    desc: "Seamlessly integrate with Okta, Google Workspace, Azure AD, and other enterprise identity providers to mandate secure access.",
  },
  {
    icon: "👥",
    title: "Fine-Grained RBAC",
    desc: "Enforce strict deployment policies. Control who can view fleets, edit configurations, or trigger production rollouts.",
  },
  {
    icon: "📋",
    title: "Immutable Audit Trails",
    desc: "The platform records every configuration change, rollout, and rollback. Export comprehensive audit logs for compliance reviews.",
  },
  {
    icon: "💸",
    title: "Cost & Data Governance",
    desc: "Push dynamic filtering rules to the edge. Mask PII and drop low-value telemetry before it incurs expensive egress or backend ingestion costs.",
  },
  {
    icon: "🗄️",
    title: "Custom Retention",
    desc: "Extended configuration history and long-term storage of fleet telemetry to satisfy rigorous internal retention policies.",
  },
  {
    icon: "🛟",
    title: "Dedicated Support & SLAs",
    desc: "Get 24/7 support, named technical contacts, and robust uptime SLAs designed for mission-critical infrastructure.",
  },
];

const compliance = ["SOC 2", "GDPR", "HIPAA", "ISO 27001", "FedRAMP"];

export default function EnterprisePage() {
  return (
    <>
      <section className="hero wrap">
        <div className="hero-meta">
          <span className="pin">Enterprise</span>
        </div>
        <h1>
          Observability Governance
          <br /> for the Enterprise
        </h1>
        <p className="lede">
          Take control of your telemetry data at the edge. Ensure compliance, enforce strict access
          policies, and maintain comprehensive audit trails across your global OpenTelemetry fleet.
        </p>
        <div className="hero-actions">
          <Link to="/signup" className="btn btn-primary btn-lg">
            Request a demo
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Enterprise-Ready Foundations</span>
            <h2>Security and control at scale.</h2>
          </div>
          <div className="grid-3">
            {features.map((f) => (
              <div key={f.title} className="card card-pad">
                <div aria-hidden="true" style={{ fontSize: "2rem", marginBottom: 12 }}>
                  {f.icon}
                </div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Compliance planning</span>
          </div>
          <p className="lede" style={{ marginBottom: 24 }}>
            Designed with security and auditability in mind. Our platform supports common compliance
            framework requirements for telemetry data management.
          </p>
          <div className="compliance-grid">
            {compliance.map((c) => (
              <div key={c} className="card card-pad" style={{ textAlign: "center" }}>
                <strong>{c} requirements</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="cta-block">
            <h2>Talk to us about enterprise</h2>
            <p className="lede">
              We'll walk you through hosted access, compliance requirements, and a deployment plan
              that fits your organization.
            </p>
            <div className="hero-actions">
              <Link to="/signup" className="btn btn-primary btn-lg">
                Contact Sales
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
