import { Link, Outlet, useLocation } from "react-router-dom";
import { Logo } from "@/components/common/Logo";

const NAV_LINKS = [
  { label: "Home", to: "/" },
  { label: "Product", to: "/product/configuration-management" },
  { label: "Pricing", to: "/pricing" },
  { label: "Enterprise", to: "/enterprise" },
  { label: "About", to: "/about" },
  { label: "Docs", to: "/docs/" },
] as const;

const FOOTER_PRODUCT = [
  { label: "Configuration management", to: "/product/configuration-management" },
  { label: "UI or Git workflow", to: "/solutions/gitops" },
  { label: "Pricing", to: "/pricing" },
  { label: "Enterprise", to: "/enterprise" },
];
const FOOTER_RESOURCES = [
  { label: "Docs", to: "/docs/" },
  { label: "OpAMP guide", to: "#" },
  { label: "Collector guide", to: "#" },
  { label: "Pricing", to: "/pricing" },
];
const FOOTER_COMPANY = [
  { label: "About", to: "/about" },
  { label: "Contact", to: "#" },
  { label: "Security", to: "#" },
  { label: "Status", to: "#" },
];
const FOOTER_LEGAL = [
  { label: "Privacy", to: "#" },
  { label: "Terms", to: "#" },
];

function FooterColumn({ title, links }: { title: string; links: { label: string; to: string }[] }) {
  return (
    <div className="footer-col">
      <h5>{title}</h5>
      <ul>
        {links.map((l) => (
          <li key={l.label}>
            <Link to={l.to}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MarketingLayout() {
  const { pathname } = useLocation();

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="logo" aria-label="O11yFleet home">
            <Logo />
            O11yFleet
          </Link>

          <nav className="nav">
            {NAV_LINKS.filter((n) => n.label !== "Home").map((n) => (
              <Link key={n.to} to={n.to} aria-current={pathname === n.to ? "page" : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="header-right">
            <Link to="/login" className="btn btn-ghost btn-sm">
              Sign in
            </Link>
            <Link to="/signup" className="btn btn-primary btn-sm">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <Outlet />

      <footer className="site-footer">
        <div className="wrap">
          <div className="footer-brand">
            <Link to="/" className="logo">
              <Logo />
              O11yFleet
            </Link>
            <p>The hosted OpAMP control plane for OpenTelemetry Collectors.</p>
          </div>
          <FooterColumn title="Product" links={FOOTER_PRODUCT} />
          <FooterColumn title="Resources" links={FOOTER_RESOURCES} />
          <FooterColumn title="Company" links={FOOTER_COMPANY} />
          <FooterColumn title="Legal" links={FOOTER_LEGAL} />
        </div>
        <div className="footer-bottom">
          <span className="mono">© 2026 O11yFleet, Inc.</span>
          <span className="mono">v0.42 · all systems healthy</span>
        </div>
      </footer>
    </>
  );
}
