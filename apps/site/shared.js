// Shared header + footer injector. Pages call FB.render(currentPath).
// Keeps every page lean and consistent.
window.FB = (function () {
  function header(active) {
    return `
<header class="site-header">
  <div class="wrap">
    <a href="index.html" class="logo" aria-label="O11yFleet home">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 6.5L12 2L21 6.5V13C21 17.5 17 20.5 12 22C7 20.5 3 17.5 3 13V6.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
        <circle cx="12" cy="11" r="2.2" fill="currentColor"/>
        <path d="M7 11H9.5M14.5 11H17M12 6V8.5M12 13.5V16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      O11yFleet
    </a>
    <nav class="nav" data-nav>
      <div class="nav-group">
        <button class="nav-trigger" type="button">Product
          <svg class="chev" viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="nav-menu">
          <a href="product-configuration-management.html">Configuration management<small>Versioned configs, rollouts, rollback</small></a>
          <a href="solutions-gitops.html">UI or Git workflow<small>Pick the workflow per configuration</small></a>
          <a href="pricing.html">Plans & features<small>What's included at each tier</small></a>
        </div>
      </div>
      <div class="nav-group">
        <button class="nav-trigger" type="button">Solutions
          <svg class="chev" viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="nav-menu">
          <a href="product-configuration-management.html">Manage collector configuration<small>Stop juggling YAML by hand</small></a>
          <a href="solutions-gitops.html">GitOps for collector config<small>Commit-driven rollouts</small></a>
          <a href="enterprise.html">Enterprise collector governance<small>SSO, RBAC, audit</small></a>
        </div>
      </div>
      <a href="pricing.html" ${active==='pricing'?'aria-current="page"':''}>Pricing</a>
      <a href="#">Docs</a>
      <a href="enterprise.html" ${active==='enterprise'?'aria-current="page"':''}>Enterprise</a>
    </nav>
    <div class="header-right">
      <button class="theme-toggle" data-theme-toggle aria-label="Toggle theme">
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <a href="#" class="btn btn-ghost btn-sm">Sign in</a>
      <a href="#" class="btn btn-primary btn-sm">Start free</a>
      <button class="mobile-toggle" data-mobile-toggle aria-label="Menu">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 4h12M2 8h12M2 12h12"/></svg>
      </button>
    </div>
  </div>
</header>`;
  }
  function footer() {
    return `
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-brand">
      <a href="index.html" class="logo">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 6.5L12 2L21 6.5V13C21 17.5 17 20.5 12 22C7 20.5 3 17.5 3 13V6.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          <circle cx="12" cy="11" r="2.2" fill="currentColor"/>
          <path d="M7 11H9.5M14.5 11H17M12 6V8.5M12 13.5V16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
        O11yFleet
      </a>
      <p>The hosted OpAMP control plane for OpenTelemetry Collectors.</p>
    </div>
    <div class="footer-col"><h5>Product</h5><ul>
      <li><a href="product-configuration-management.html">Configuration management</a></li>
      <li><a href="solutions-gitops.html">UI or Git workflow</a></li>
      <li><a href="pricing.html">Pricing</a></li>
      <li><a href="enterprise.html">Enterprise</a></li>
    </ul></div>
    <div class="footer-col"><h5>Resources</h5><ul>
      <li><a href="#">Docs</a></li>
      <li><a href="#">OpAMP guide</a></li>
      <li><a href="#">Collector guide</a></li>
      <li><a href="pricing.html">Pricing</a></li>
    </ul></div>
    <div class="footer-col"><h5>Company</h5><ul>
      <li><a href="about.html">About</a></li>
      <li><a href="#">Contact</a></li>
      <li><a href="#">Security</a></li>
      <li><a href="#">Status</a></li>
    </ul></div>
    <div class="footer-col"><h5>Legal</h5><ul>
      <li><a href="#">Privacy</a></li>
      <li><a href="#">Terms</a></li>

    </ul></div>
  </div>
  <div class="footer-bottom">
    <span class="mono">© 2026 O11yFleet, Inc.</span>
    <span class="mono">v0.42 · all systems healthy</span>
  </div>
</footer>`;
  }
  return {
    render: function (active) {
      const h = document.getElementById('site-header');
      const f = document.getElementById('site-footer');
      if (h) h.outerHTML = header(active);
      if (f) f.outerHTML = footer();
    }
  };
})();
