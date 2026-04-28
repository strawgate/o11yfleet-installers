// Cloudflare Pages Function — subdomain routing + SPA fallback
// app.o11yfleet.com  → serves portal SPA (root redirects to /portal/overview)
// admin.o11yfleet.com → serves admin SPA (root redirects to /admin/overview)
// o11yfleet.com       → serves marketing site SPA

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname;

    // app.o11yfleet.com — redirect root to portal
    if (host === "app.o11yfleet.com" && (url.pathname === "/" || url.pathname === "")) {
      return Response.redirect("https://app.o11yfleet.com/portal/overview", 302);
    }

    // admin.o11yfleet.com — redirect root to admin overview
    if (host === "admin.o11yfleet.com" && (url.pathname === "/" || url.pathname === "")) {
      return Response.redirect("https://admin.o11yfleet.com/admin/overview", 302);
    }

    // Try to serve the static asset first
    const res = await env.ASSETS.fetch(request);

    // If the asset exists (not 404) or it's a file with an extension, return as-is
    if (res.status !== 404 || url.pathname.includes(".")) {
      return res;
    }

    // SPA fallback — serve index.html for client-side routing
    const indexUrl = new URL("/index.html", url.origin);
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
