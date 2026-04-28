// Cloudflare Pages Function — subdomain routing
// app.o11yfleet.com  → serves portal content (root redirects to /portal/overview)
// admin.o11yfleet.com → serves admin content (root redirects to /admin/overview)
// o11yfleet.com       → serves marketing site as-is

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname;

    // app.o11yfleet.com — redirect root to portal
    if (host === 'app.o11yfleet.com' && (url.pathname === '/' || url.pathname === '')) {
      return Response.redirect('https://app.o11yfleet.com/portal/overview', 302);
    }

    // admin.o11yfleet.com — redirect root to admin overview
    if (host === 'admin.o11yfleet.com' && (url.pathname === '/' || url.pathname === '')) {
      return Response.redirect('https://admin.o11yfleet.com/admin/overview', 302);
    }

    // Serve static assets normally
    return env.ASSETS.fetch(request);
  }
};
