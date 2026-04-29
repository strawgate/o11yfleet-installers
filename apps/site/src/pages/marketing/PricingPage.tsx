import { Link } from "react-router-dom";

const personalPlans = [
  {
    name: "Hobby",
    price: "$0",
    period: "",
    tag: "Individual",
    desc: "For one person managing a small personal collector fleet.",
    collectors: "10 collectors",
    policies: "1 policy",
    history: "24h state",
    users: "1 user",
    automation: "No API keys or repo sync",
    features: ["Live inventory and status", "Manual config deployment", "Community support"],
    cta: "Start Hobby",
    ctaTo: "/signup",
    ctaClass: "btn btn-secondary btn-lg",
    featured: false,
  },
  {
    name: "Pro",
    price: "$20",
    period: "/month",
    tag: "Individual",
    desc: "For one operator who wants history, diffs, and rollback without automation.",
    collectors: "25 collectors",
    policies: "3 policies",
    history: "7-day history",
    users: "1 user",
    automation: "No API keys or repo sync",
    features: ["Version history and diffs", "Rollback", "Stateful operations for personal fleets"],
    cta: "Start Pro",
    ctaTo: "/signup",
    ctaClass: "btn btn-secondary btn-lg",
    featured: false,
  },
];

const organizationPlans = [
  {
    name: "Starter",
    price: "$0",
    period: "",
    tag: "Organization",
    desc: "For teams that want shared fleet visibility before production governance.",
    collectors: "1,000 collectors",
    policies: "1 policy",
    history: "24h state",
    users: "3 users",
    automation: "No API keys or repo sync",
    features: ["Shared collector inventory", "Manual config deployment", "Community support"],
    cta: "Start Starter",
    ctaTo: "/signup",
    ctaClass: "btn btn-secondary btn-lg",
    featured: false,
  },
  {
    name: "Growth",
    price: "$499",
    period: "/month",
    secondaryPrice: "$5,000/year",
    tag: "Most teams",
    desc: "For organizations running collector config in production.",
    collectors: "1,000 collectors + packs",
    policies: "10 policies",
    history: "30-day history",
    users: "10 users",
    automation: "Unlimited API keys and repos",
    features: [
      "Progressive and canary rollouts",
      "Drift detection",
      "GitOps, API access, and webhooks",
      "RBAC and audit log",
    ],
    cta: "Start Growth",
    ctaTo: "/signup",
    ctaClass: "btn btn-primary btn-lg",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    secondaryPrice: "Starts at $50k/year",
    tag: "Governance",
    desc: "For large-scale and regulated collector fleets.",
    collectors: "Custom",
    policies: "Unlimited",
    history: "90d-1yr+",
    users: "Unlimited",
    automation: "Unlimited API keys and repos",
    features: [
      "SSO, SCIM, and multi-IdP",
      "Approval workflows and change windows",
      "Long-term audit retention",
      "SLA, dedicated support, and deployment options",
    ],
    cta: "Talk to sales",
    ctaTo: "/enterprise",
    ctaClass: "btn btn-secondary btn-lg",
    featured: false,
  },
];

const comparisonRows = [
  ["Collectors", "10", "25", "1,000", "1,000 + packs", "Custom"],
  ["Policies", "1", "3", "1", "10", "Unlimited"],
  ["History", "24h", "7 days", "24h", "30 days", "90d-1yr+"],
  ["Users", "1", "1", "3", "10", "Unlimited"],
  ["API keys", "None", "None", "None", "Unlimited", "Unlimited"],
  ["Repo sync", "None", "None", "None", "Unlimited", "Unlimited"],
  ["Progressive rollouts", "No", "No", "No", "Yes", "Yes"],
  ["RBAC and audit", "No", "No", "No", "Yes", "Advanced"],
  ["SSO / SCIM", "No", "No", "No", "No", "Yes"],
];

type Plan = (typeof personalPlans | typeof organizationPlans)[number];

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div
      className={`card card-pad${plan.featured ? " featured" : ""}`}
      style={plan.featured ? { borderColor: "var(--accent, #635bff)", borderWidth: 2 } : undefined}
    >
      <div className="row-sb">
        <h3>{plan.name}</h3>
        <span className="tag">{plan.tag}</span>
      </div>
      <p style={{ fontSize: "2rem", fontWeight: 700, margin: "12px 0 4px" }}>
        {plan.price}
        <span style={{ fontSize: "1rem", fontWeight: 400 }}>{plan.period}</span>
      </p>
      {"secondaryPrice" in plan ? <p className="meta">{plan.secondaryPrice}</p> : null}
      <p>{plan.desc}</p>
      <div className="stack-2" style={{ margin: "20px 0" }}>
        {[plan.collectors, plan.policies, plan.history, plan.users, plan.automation].map(
          (item, index) => (
            <div key={`${plan.name}-${index}`} className="row-sb" style={{ gap: 16 }}>
              <span className="meta">{item}</span>
            </div>
          ),
        )}
      </div>
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
  );
}

export default function PricingPage() {
  return (
    <>
      <section className="hero wrap">
        <h1>Manage 1,000 collectors for free.</h1>
        <p className="lede">
          Collector fleet management that starts free. Upgrade when your team needs production
          rollouts, history, automation, and governance.
        </p>
        <p className="meta" style={{ marginTop: 18 }}>
          Fleet management is free; production governance is paid.
        </p>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Individual track</span>
            <h2>UI-driven plans for one operator.</h2>
            <p className="meta">No API keys, no repo sync, no company CI/CD on individual plans.</p>
          </div>
          <div className="grid-2">
            {personalPlans.map((plan) => (
              <PlanCard key={plan.name} plan={plan} />
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Organization track</span>
            <h2>Automation and governance for production teams.</h2>
            <p className="meta">
              API access, GitOps, Terraform, and CI/CD automation start at Growth.
            </p>
          </div>
          <div className="grid-3">
            {organizationPlans.map((plan) => (
              <PlanCard key={plan.name} plan={plan} />
            ))}
          </div>
          <p className="meta" style={{ marginTop: 18 }}>
            Growth collector packs are $499/month, or $5,000/year, per additional 1,000 collectors.
            Self-serve Growth is intended for fleets up to roughly 5,000 collectors.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Compare plans</span>
            <h2>Policies and history are the paid axis.</h2>
          </div>
          <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
            <table className="dt" aria-label="Plan feature comparison" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col">Hobby</th>
                  <th scope="col">Pro</th>
                  <th scope="col">Starter</th>
                  <th scope="col">Growth</th>
                  <th scope="col">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map(([feature, hobby, pro, starter, growth, enterprise]) => (
                  <tr key={feature}>
                    <th scope="row">{feature}</th>
                    <td>{hobby}</td>
                    <td>{pro}</td>
                    <td>{starter}</td>
                    <td>{growth}</td>
                    <td>{enterprise}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meta" style={{ marginTop: 18 }}>
            A policy is the customer-facing management unit: collector selection, rendered config,
            versioning, and rollout rules. Internally this still maps to configuration groups.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="cta-block">
            <h2>Not sure which plan?</h2>
            <p className="lede">
              Start with Starter for fleet visibility. Move to Growth when production automation,
              rollout safety, history, RBAC, or audit become real requirements.
            </p>
            <div className="hero-actions">
              <Link to="/signup" className="btn btn-primary btn-lg">
                Request access
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
