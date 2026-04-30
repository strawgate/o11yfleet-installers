import { Link } from "react-router-dom";

const features = [
  {
    icon: "🔐",
    title: "SSO & SAML",
    desc: "Enterprise identity integrations are planned; contact us to discuss requirements.",
  },
  {
    icon: "👥",
    title: "Role-based access",
    desc: "Tenant isolation exists today; fine-grained RBAC is planned.",
  },
  {
    icon: "📋",
    title: "Audit trail",
    desc: "Configuration versions are recorded today; broader audit export is planned.",
  },
  {
    icon: "🗄️",
    title: "Custom retention",
    desc: "Discuss retention requirements before production deployment.",
  },
  {
    icon: "🛟",
    title: "Custom support",
    desc: "Support terms are handled case by case for enterprise customers.",
  },
  {
    icon: "📄",
    title: "SLAs",
    desc: "SLA terms are handled case by case while the hosted service is early.",
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
          Collector governance
          <br /> for large organizations
        </h1>
        <p className="lede">
          Planning support for SSO, audit trails, role-based access, custom retention, and support
          terms for companies with enterprise requirements.
        </p>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="grid-3">
            {features.map((f) => (
              <div key={f.title} className="card card-pad">
                <div style={{ fontSize: "2rem", marginBottom: 12 }}>{f.icon}</div>
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
            <span className="eyebrow">Compliance</span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 24,
            }}
          >
            {compliance.map((c) => (
              <div key={c} className="card card-pad" style={{ textAlign: "center" }}>
                <strong>{c}</strong>
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
                Request a demo
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
