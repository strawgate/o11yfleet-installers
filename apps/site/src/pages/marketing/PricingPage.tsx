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
    policies: "1 policy",
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
    desc: "For solo operators who need just a little bit more.",
    collectors: "25 collectors",
    policies: "3 policies",
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
    desc: "For small teams that want shared visibility before production governance.",
    collectors: "1,000 collectors",
    policies: "1 policy",
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
    desc: "For organizations running collectors in production.",
    collectors: "1,000 collectors",
    policies: "10 policies",
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
    desc: "For companies with enterprise requirements.",
    collectors: "Custom collectors",
    policies: "Unlimited policies",
    history: "90d-1yr+",
    users: "Unlimited users",
    repos: "Unlimited repositories",
    support: "Custom",
    cta: "Contact us",
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
    ["Management policies", plan.policies],
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
            Free for teams with up to 1000 collectors. Who even has more than a thousand collectors?
            Upgrade when you need more management policies, users, history, or repo sync.
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
          <div className="pricing-track" id="personal-plans">
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
                I&apos;ll be inviting friends
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
