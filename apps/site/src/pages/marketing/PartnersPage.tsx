import { Link } from "react-router-dom";

const partnerTypes = [
  {
    eyebrow: "MSPs",
    title: "Managed service providers",
    desc: "Run collector fleets across many client environments from a single control plane. Multi-tenant isolation, per-tenant rollouts, and consolidated visibility — without standing up infrastructure for every customer.",
  },
  {
    eyebrow: "Consultancies",
    title: "Observability consultancies",
    desc: "Stand up production-ready collector pipelines for clients in days, not months. Bring your reference configurations, hand them off cleanly, and stay engaged through ongoing rollouts.",
  },
  {
    eyebrow: "Technology",
    title: "Technology partners",
    desc: "Backends, SIEMs, and APM vendors that receive OTLP. We don't compete for the destination — we make it easier for collectors in the field to point at yours, reliably and verifiably.",
  },
  {
    eyebrow: "Resellers",
    title: "Resellers & distributors",
    desc: "Sell hosted O11yFleet alongside your existing observability portfolio. Discounted seat pricing, co-terminated contracts, and a clean handoff for support.",
  },
];

const benefits = [
  {
    icon: "🏢",
    title: "Multi-tenant by design",
    desc: "Isolate every client's fleet, configurations, and tokens. Switch contexts without juggling logins.",
  },
  {
    icon: "📈",
    title: "Predictable economics",
    desc: "Pay for management, not telemetry volume. Margins stay yours as your clients' data grows.",
  },
  {
    icon: "🔧",
    title: "Open standards",
    desc: "Built on OpAMP and OpenTelemetry. No bespoke agents to deploy, no proprietary lock-in to explain.",
  },
  {
    icon: "🚀",
    title: "Faster onboarding",
    desc: "Reference configurations, enroll tokens, and rollout flows are designed for repeat client launches.",
  },
  {
    icon: "🤝",
    title: "Direct line to engineering",
    desc: "Shared Slack channel, roadmap access, and early features for active partners.",
  },
  {
    icon: "📣",
    title: "Co-marketing",
    desc: "Joint case studies, partner directory listing, and inbound referrals once you're certified.",
  },
];

const tiers = [
  {
    name: "Registered",
    tagline: "Get started",
    items: [
      "Partner directory listing",
      "Self-serve enablement materials",
      "Discounted seat pricing",
      "Community support channel",
    ],
  },
  {
    name: "Certified",
    tagline: "Active practice",
    featured: true,
    items: [
      "Everything in Registered",
      "Named technical contact",
      "Reference architecture review",
      "Co-marketing opportunities",
      "Inbound referral eligibility",
    ],
  },
  {
    name: "Strategic",
    tagline: "Deep integration",
    items: [
      "Everything in Certified",
      "Roadmap input & early access",
      "Joint go-to-market planning",
      "Custom commercial terms",
      "Dedicated solutions engineering",
    ],
  },
];

const steps = [
  {
    n: 1,
    title: "Apply",
    desc: "Tell us about your practice, the clients you serve, and the outcomes you deliver.",
  },
  {
    n: 2,
    title: "Enable",
    desc: "Walk through the platform with our team and run a pilot fleet on a real workload.",
  },
  {
    n: 3,
    title: "Certify",
    desc: "Demonstrate a successful client deployment and join the partner directory.",
  },
  {
    n: 4,
    title: "Grow",
    desc: "Roll out to more clients, share feedback into the roadmap, and expand the practice.",
  },
];

export default function PartnersPage() {
  return (
    <>
      <section className="hero wrap">
        <div className="hero-meta">
          <span className="pin">Partners</span>
        </div>
        <h1>
          Build an observability practice
          <br /> on an open control plane
        </h1>
        <p className="lede" style={{ marginTop: 22 }}>
          Whether you manage collectors for dozens of clients, deliver observability engagements, or
          ship a backend that receives OTLP — partner with O11yFleet to operate fleets at scale
          without locking anyone into a proprietary agent.
        </p>
        <div className="hero-actions">
          <a href="mailto:partners@o11yfleet.com" className="btn btn-primary btn-lg">
            Apply to partner →
          </a>
          <Link to="/enterprise" className="btn btn-secondary btn-lg">
            See enterprise features
          </Link>
        </div>
        <div className="trust-strip">
          <span>Multi-tenant by default</span>
          <span>OpAMP &amp; OpenTelemetry native</span>
          <span>No telemetry pass-through</span>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Who partners with us</span>
            <h2>Four ways to work together</h2>
          </div>
          <div className="grid-2">
            {partnerTypes.map((p) => (
              <div key={p.title} className="card card-pad">
                <span className="eyebrow">{p.eyebrow}</span>
                <h3 style={{ marginTop: 8 }}>{p.title}</h3>
                <p>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Why partner</span>
            <h2>Built for teams that operate fleets, not just one</h2>
          </div>
          <div className="grid-3">
            {benefits.map((b) => (
              <div key={b.title} className="card card-pad">
                <div aria-hidden="true" style={{ fontSize: "2rem", marginBottom: 12 }}>
                  {b.icon}
                </div>
                <h3>{b.title}</h3>
                <p>{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Program</span>
            <h2>Three tiers, one path</h2>
          </div>
          <div className="grid-3">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className="card card-pad"
                style={
                  tier.featured
                    ? {
                        borderColor: "var(--accent, #7c5cff)",
                        borderWidth: 2,
                        borderStyle: "solid",
                      }
                    : undefined
                }
              >
                <span className="eyebrow">{tier.tagline}</span>
                <h3 style={{ marginTop: 8 }}>{tier.name}</h3>
                <ul style={{ marginTop: 16, paddingLeft: 18, lineHeight: 1.7 }}>
                  {tier.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2>From application to active practice</h2>
          </div>
          <div className="grid-4">
            {steps.map((step) => (
              <div key={step.n} className="card card-pad">
                <div
                  className="mono"
                  style={{ fontSize: "0.875rem", color: "var(--muted, #888)", marginBottom: 8 }}
                >
                  Step {step.n}
                </div>
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="cta-block">
            <h2>Let's build the program together.</h2>
            <p className="lede">
              The partner program is opening to a small set of practices in 2026. Tell us what
              you're building and we'll set up a working session.
            </p>
            <div className="hero-actions">
              <a href="mailto:partners@o11yfleet.com" className="btn btn-primary btn-lg">
                Apply to partner →
              </a>
              <Link to="/about" className="btn btn-secondary btn-lg">
                Read about our approach
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
