import { useState } from "react";
import { Link } from "react-router-dom";

type BillingCycle = "monthly" | "annual";

const personalPlans = [
  {
    name: "Hobby",
    monthlyPrice: "$0",
    annualPrice: "$0",
    period: "",
    desc: "For one person keeping a small collector fleet in line from the UI.",
    collectors: "10 collectors",
    policies: "1 policy",
    users: "1 user",
    repos: "No repo sync",
    features: ["Live inventory and status", "Manual config deployment", "Community support"],
    cta: "Start Hobby",
    ctaTo: "/signup",
    ctaClass: "btn btn-secondary btn-lg",
    featured: false,
  },
  {
    name: "Pro",
    monthlyPrice: "$20",
    annualPrice: "$20",
    period: "/month",
    desc: "For one operator who wants history, diffs, and rollback without automation.",
    collectors: "25 collectors",
    policies: "3 policies",
    history: "7-day history",
    users: "1 user",
    repos: "No repo sync",
    features: ["Version history and diffs", "Rollback"],
    cta: "Start Pro",
    ctaTo: "/signup",
    ctaClass: "btn btn-secondary btn-lg",
    featured: false,
  },
];

const organizationPlans = [
  {
    name: "Starter",
    monthlyPrice: "$0",
    annualPrice: "$0",
    period: "",
    desc: "For small teams that want shared visibility before production governance.",
    collectors: "1,000 collectors",
    policies: "1 policy",
    users: "3 users",
    repos: "No repo sync",
    features: ["Shared collector inventory", "Manual config deployment", "Community support"],
    cta: "Start Starter",
    ctaTo: "/signup",
    ctaClass: "btn btn-secondary btn-lg",
    featured: false,
  },
  {
    name: "Growth",
    monthlyPrice: "$499",
    annualPrice: "$5,000",
    period: "/month",
    annualPeriod: "/year",
    desc: "For organizations running collector config in production.",
    collectors: "1,000 collectors",
    policies: "10 policies",
    history: "30-day history",
    users: "10 users",
    repos: "10 repositories",
    features: [
      "Progressive and canary rollouts",
      "Drift detection",
      "Unlimited API keys",
      "RBAC and audit log",
    ],
    cta: "Start Growth",
    ctaTo: "/signup",
    ctaClass: "btn btn-primary btn-lg",
    featured: true,
  },
  {
    name: "Enterprise",
    monthlyPrice: "Custom",
    annualPrice: "Custom",
    period: "",
    secondaryPrice: "Starts at $50k/year",
    desc: "For large-scale and regulated collector fleets.",
    collectors: "Custom collectors",
    policies: "Unlimited policies",
    history: "90d-1yr+",
    users: "Unlimited users",
    repos: "Unlimited repositories",
    features: [
      "SSO, SCIM, and multi-IdP",
      "Long-term audit retention",
      "Unlimited API keys",
      "SLA, dedicated support, and deployment options",
    ],
    cta: "Talk to sales",
    ctaTo: "/enterprise",
    ctaClass: "btn btn-secondary btn-lg",
    featured: false,
  },
];

const comparisonRows = [
  ["Collectors", "10", "25", "1,000", "1,000", "Custom collectors"],
  ["Policies", "1", "3", "1", "10", "Unlimited policies"],
  ["History", "Live only", "7 days", "Live only", "30 days", "90d-1yr+"],
  ["Users", "1", "1", "3", "10", "Unlimited users"],
  ["API keys", "None", "None", "None", "Unlimited API keys", "Unlimited API keys"],
  ["Repo sync", "None", "None", "None", "10 repositories", "Unlimited repositories"],
  ["Progressive rollouts", "No", "No", "No", "Yes", "Yes"],
  ["RBAC and audit", "No", "No", "No", "Yes", "Advanced"],
  ["SSO / SCIM", "No", "No", "No", "No", "Yes"],
];

type Plan = (typeof personalPlans | typeof organizationPlans)[number];

function BillingToggle({
  value,
  onChange,
}: {
  value: BillingCycle;
  onChange: (value: BillingCycle) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Billing cycle">
      <button
        type="button"
        role="radio"
        className={value === "monthly" ? "active" : ""}
        aria-checked={value === "monthly"}
        onClick={() => onChange("monthly")}
      >
        Monthly
      </button>
      <button
        type="button"
        role="radio"
        className={value === "annual" ? "active" : ""}
        aria-checked={value === "annual"}
        onClick={() => onChange("annual")}
      >
        Annual
      </button>
    </div>
  );
}

function PlanCard({ plan, billingCycle }: { plan: Plan; billingCycle: BillingCycle }) {
  const price = billingCycle === "annual" ? plan.annualPrice : plan.monthlyPrice;
  const period =
    billingCycle === "annual" && "annualPeriod" in plan && plan.annualPeriod
      ? plan.annualPeriod
      : plan.period;
  const limits = [
    ["Collectors", plan.collectors],
    ["Policies", plan.policies],
    ["Users", plan.users],
    ["Repos", plan.repos],
  ];
  if ("history" in plan && plan.history) limits.splice(2, 0, ["History", plan.history]);

  return (
    <div
      className={`card pricing-card${plan.featured ? " featured" : ""}`}
      style={plan.featured ? { borderColor: "var(--accent, #635bff)", borderWidth: 2 } : undefined}
    >
      <h3>{plan.name}</h3>
      <p className="pricing-price">
        {price}
        <span>{period}</span>
      </p>
      {period !== plan.period ? (
        <p className="meta">Annual billing</p>
      ) : "secondaryPrice" in plan ? (
        <p className="meta">{plan.secondaryPrice}</p>
      ) : null}
      <p className="pricing-desc">{plan.desc}</p>
      <div className="pricing-limits">
        {limits.map(([label, value]) => (
          <div key={`${plan.name}-${label}`}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className="pricing-includes">
        <span>Includes</span>
        {plan.features.join(", ")}.
      </p>
      <Link to={plan.ctaTo} className={plan.ctaClass}>
        {plan.cta}
      </Link>
    </div>
  );
}

export default function PricingPage() {
  const [individualBillingCycle, setIndividualBillingCycle] = useState<BillingCycle>("monthly");
  const [organizationBillingCycle, setOrganizationBillingCycle] = useState<BillingCycle>("monthly");

  return (
    <>
      <section className="hero wrap pricing-hero">
        <h1>Cost: Probably $0.</h1>
        <p className="lede">
          Connect the fleet for free. Pay when production needs history, safer rollouts, automation,
          and governance.
        </p>
        <p className="meta" style={{ marginTop: 18 }}>
          Fleet management is free; production governance is paid.
        </p>
      </section>

      <section className="section pricing-plans-section">
        <div className="wrap pricing-tracks">
          <div className="pricing-track">
            <div className="pricing-track-head">
              <div>
                <span className="eyebrow">Individual track</span>
                <h2>Personal fleets.</h2>
                <p className="meta">The perfect plan if you like clicky clicky.</p>
              </div>
              <BillingToggle value={individualBillingCycle} onChange={setIndividualBillingCycle} />
            </div>
            <div className="grid-2">
              {personalPlans.map((plan) => (
                <PlanCard key={plan.name} plan={plan} billingCycle={individualBillingCycle} />
              ))}
            </div>
          </div>
          <div className="pricing-track">
            <div className="pricing-track-head">
              <div>
                <span className="eyebrow">Organization track</span>
                <h2>Team fleets.</h2>
                <p className="meta">Invite some friends and stay a while.</p>
              </div>
              <BillingToggle
                value={organizationBillingCycle}
                onChange={setOrganizationBillingCycle}
              />
            </div>
            <div className="grid-3">
              {organizationPlans.map((plan) => (
                <PlanCard key={plan.name} plan={plan} billingCycle={organizationBillingCycle} />
              ))}
            </div>
          </div>
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
