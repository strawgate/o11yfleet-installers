import { useState } from "react";
import { Link } from "react-router-dom";

type BillingCycle = "monthly" | "annual";

const personalPlans = [
  {
    name: "Hobby",
    monthlyPrice: "$0",
    annualPrice: "$0",
    period: "",
    desc: "The perfect plan for simple monitoring in personal projects.",
    collectors: "10 collectors",
    configurations: "1 configuration",
    users: "1 user",
    support: "Community",
    cta: "Start Hobby",
    ctaTo: "/signup?plan=hobby",
    ctaClass: "btn btn-secondary btn-lg",
    featured: false,
  },
  {
    name: "Pro",
    monthlyPrice: "$29",
    annualPrice: "$290",
    period: "/month",
    annualPeriod: "/year",
    desc: "For solo operators who need a little bit more.",
    collectors: "25 collectors",
    configurations: "3 configurations",
    history: "7-day history",
    users: "1 user",
    support: "Email",
    cta: "Start Pro",
    ctaTo: "/signup?plan=pro",
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
    desc: "For teams that want shared visibility before strict production governance.",
    collectors: "1,000 collectors",
    configurations: "1 configuration",
    users: "3 users",
    repos: "No repo sync",
    support: "Community",
    cta: "Start Starter",
    ctaTo: "/signup?plan=starter",
    ctaClass: "btn btn-secondary btn-lg",
    secondaryCta: "Solo Developer?",
    secondaryHref: "#personal-plans",
    featured: false,
  },
  {
    name: "Growth",
    monthlyPrice: "$499",
    annualPrice: "$5,000",
    period: "/month",
    annualPeriod: "/year",
    desc: "For organizations actively operating collectors in production.",
    collectors: "1,000 collectors",
    configurations: "10 configurations",
    history: "30-day history",
    users: "10 users",
    repos: "10 repositories",
    support: "Email",
    cta: "Start Growth",
    ctaTo: "/signup?plan=growth",
    ctaClass: "btn btn-primary btn-lg",
    featured: true,
  },
  {
    name: "Enterprise",
    monthlyPrice: "Custom",
    annualPrice: "Custom",
    period: "",
    secondaryPrice: "Starts at $50k/year",
    desc: "For companies requiring strict compliance, SSO, and infinite scale.",
    collectors: "Custom collectors",
    configurations: "Unlimited configurations",
    history: "90d-1yr+",
    users: "Unlimited users",
    repos: "Unlimited repositories",
    support: "Custom SLA",
    cta: "Contact Sales",
    ctaTo: "/enterprise",
    ctaClass: "btn btn-secondary btn-lg",
    featured: false,
  },
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
    ["Configurations", plan.configurations],
  ];
  if ("history" in plan && plan.history) limits.splice(2, 0, ["History", plan.history]);
  limits.push(["Users", plan.users]);
  if ("repos" in plan && plan.repos) limits.push(["Repositories", plan.repos]);
  limits.push(["Support", plan.support]);

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
      <div className="pricing-card-actions">
        {"secondaryCta" in plan && plan.secondaryCta ? (
          <a href={plan.secondaryHref} className="btn btn-secondary btn-lg">
            {plan.secondaryCta}
          </a>
        ) : null}
        <Link to={plan.ctaTo} className={plan.ctaClass}>
          {plan.cta}
        </Link>
      </div>
    </div>
  );
}

export default function PricingPage() {
  const [individualBillingCycle, setIndividualBillingCycle] = useState<BillingCycle>("monthly");
  const [organizationBillingCycle, setOrganizationBillingCycle] = useState<BillingCycle>("monthly");

  return (
    <>
      <section className="hero wrap pricing-hero">
        <div className="pricing-hero-copy">
          <span className="eyebrow">Pricing</span>
          <h1>Your cost is probably $0.</h1>
          <p className="lede">
            Free for teams with up to 1,000 collectors. We believe basic visibility should be free.
            Upgrade when you need advanced rollout governance, extended history, or team controls.
          </p>
        </div>
      </section>

      <section className="section pricing-plans-section">
        <div className="wrap pricing-tracks">
          <div className="pricing-track" id="team-plans">
            <div className="pricing-track-head">
              <div>
                <span className="eyebrow">Organization track</span>
                <h2>Team fleets.</h2>
                <p className="meta">Shared visibility and strict governance.</p>
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
          <div className="pricing-track" id="personal-plans">
            <div className="pricing-track-head">
              <div>
                <span className="eyebrow">Individual track</span>
                <h2>Personal fleets.</h2>
                <p className="meta">For solo operators and side projects.</p>
              </div>
              <BillingToggle value={individualBillingCycle} onChange={setIndividualBillingCycle} />
            </div>
            <div className="grid-2">
              {personalPlans.map((plan) => (
                <PlanCard key={plan.name} plan={plan} billingCycle={individualBillingCycle} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section pricing-decision-section">
        <div className="wrap">
          <div className="cta-block pricing-decision">
            <h2>Not sure which plan?</h2>
            <p>Start free. Pick the path that matches how you will use the fleet.</p>
            <div className="pricing-decision-actions">
              <Link to="/signup?plan=hobby" className="btn btn-secondary btn-lg">
                Flying solo
              </Link>
              <Link to="/signup?plan=starter" className="btn btn-primary btn-lg">
                I'll be inviting my team
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
