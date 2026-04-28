import { Link } from "react-router-dom";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "/month",
    desc: "For teams getting started with collector visibility.",
    features: ["5 configurations", "50K agents", "Monitor-only included", "Community support"],
    cta: "Start free →",
    ctaTo: "/signup",
    ctaClass: "btn btn-secondary btn-lg",
    featured: false,
  },
  {
    name: "Pro",
    price: "$49",
    period: "/month",
    desc: "For teams managing configs and rollouts.",
    features: ["50 configurations", "100K agents", "GitHub sync", "Rollouts", "Priority support"],
    cta: "Start free →",
    ctaTo: "/signup",
    ctaClass: "btn btn-primary btn-lg",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For organizations with governance and compliance needs.",
    features: [
      "1000 configurations",
      "500K agents",
      "SSO / SAML",
      "Audit trail",
      "Dedicated support",
      "SLAs",
    ],
    cta: "Talk to sales",
    ctaTo: "/enterprise",
    ctaClass: "btn btn-secondary btn-lg",
    featured: false,
  },
];

export default function PricingPage() {
  return (
    <>
      <section className="hero wrap">
        <h1>
          Simple pricing.
          <br />
          No telemetry tax.
        </h1>
        <p className="lede">Pay for collector management, not for the data flowing through them.</p>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="grid-3">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`card card-pad${plan.featured ? " featured" : ""}`}
                style={
                  plan.featured
                    ? { borderColor: "var(--accent, #635bff)", borderWidth: 2 }
                    : undefined
                }
              >
                <h3>{plan.name}</h3>
                <p style={{ fontSize: "2rem", fontWeight: 700, margin: "12px 0 4px" }}>
                  {plan.price}
                  <span style={{ fontSize: "1rem", fontWeight: 400 }}>{plan.period}</span>
                </p>
                <p>{plan.desc}</p>
                <ul style={{ listStyle: "none", padding: 0, margin: "24px 0" }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{ padding: "6px 0" }}>
                      ✓ {f}
                    </li>
                  ))}
                </ul>
                <Link to={plan.ctaTo} className={plan.ctaClass}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="cta-block">
            <h2>Not sure which plan?</h2>
            <p className="lede">
              Start on the free tier. Upgrade when you need config management or rollouts.
            </p>
            <div className="hero-actions">
              <Link to="/signup" className="btn btn-primary btn-lg">
                Start free →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
