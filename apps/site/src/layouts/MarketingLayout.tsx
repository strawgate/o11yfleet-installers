import { Link, Outlet, useLocation } from "react-router-dom";
import { Logo } from "@/components/common/Logo";

const NAV_LINKS = [
  { label: "Home", to: "/" },
  { label: "Product", to: "/product/configuration-management" },
  { label: "Pricing", to: "/pricing" },
  { label: "Enterprise", to: "/enterprise" },
  { label: "Partners", to: "/partners" },
  { label: "About", to: "/about" },
  { label: "Docs", to: "/docs/index.html" },
] as const;

const FOOTER_PRODUCT = [
  { label: "Configuration management", to: "/product/configuration-management" },
  { label: "UI or Git workflow", to: "/solutions/gitops" },
  { label: "Pricing", to: "/pricing" },
  { label: "Enterprise", to: "/enterprise" },
];
const FOOTER_RESOURCES = [
  { label: "Docs", to: "/docs/index.html" },
  { label: "OpAMP guide", to: "/docs/concepts/opamp.html" },
  { label: "Collector guide", to: "/docs/how-to/connect-collector.html" },
  { label: "Pricing", to: "/pricing" },
];
const FOOTER_COMPANY = [
  { label: "About", to: "/about" },
  { label: "Partners", to: "/partners" },
  { label: "Contact", to: "mailto:hello@o11yfleet.com" },
  { label: "Security", to: "mailto:security@o11yfleet.com" },
];

function isDocumentLink(to: string) {
  return to.startsWith("mailto:") || to.endsWith(".html");
}

function isNavActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function FooterColumn({ title, links }: { title: string; links: { label: string; to: string }[] }) {
  return (
    <div className="footer-col">
      <h5>{title}</h5>
      <ul>
        {links.map((l) => (
          <li key={l.label}>
            {isDocumentLink(l.to) ? <a href={l.to}>{l.label}</a> : <Link to={l.to}>{l.label}</Link>}
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
            {NAV_LINKS.filter((n) => n.label !== "Home").map((n) =>
              isDocumentLink(n.to) ? (
                <a key={n.to} href={n.to} aria-current={pathname === n.to ? "page" : undefined}>
                  {n.label}
                </a>
              ) : (
                <Link
                  key={n.to}
                  to={n.to}
                  aria-current={isNavActive(pathname, n.to) ? "page" : undefined}
                >
                  {n.label}
                </Link>
              ),
            )}
          </nav>

          <div className="header-right">
            <Link to="/login" className="btn btn-ghost btn-sm">
              Sign in
            </Link>
            <Link to="/signup" className="btn btn-primary btn-sm">
              Request access
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
            <p>The best way to manage your fleet of OpenTelemetry Collectors.</p>
          </div>
          <FooterColumn title="Product" links={FOOTER_PRODUCT} />
          <FooterColumn title="Resources" links={FOOTER_RESOURCES} />
          <FooterColumn title="Company" links={FOOTER_COMPANY} />
        </div>
        <div className="footer-bottom">
          <span className="mono">© 2026 O11yFleet, Inc.</span>
          <span className="mono">Public preview</span>
        </div>
      </footer>
    </>
  );
}
