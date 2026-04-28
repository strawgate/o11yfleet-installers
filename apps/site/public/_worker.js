// Cloudflare Pages Function — subdomain routing + SPA fallback
// app.o11yfleet.com  → serves portal SPA (root redirects to /portal/overview)
// admin.o11yfleet.com → serves admin SPA (root redirects to /admin/overview)
// o11yfleet.com       → serves marketing site SPA

// Known static asset prefixes/extensions that should be served directly
const STATIC_ASSET_RE =
  /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|json|txt|xml|webmanifest)$/;

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

    // Redirect .html paths to clean URLs (backward compat for cached/bookmarked links)
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname.endsWith(".html") &&
      url.pathname !== "/index.html"
    ) {
      const clean = url.pathname.replace(/\.html$/, "");
      const dest = new URL(clean, url.origin);
      dest.search = url.search;
      return Response.redirect(dest.toString(), 301);
    }

    // Static assets (JS, CSS, images, fonts) — serve directly with long cache
    if (STATIC_ASSET_RE.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    // Known non-HTML files from public/ (install scripts, _headers, etc.)
    if (
      url.pathname === "/install.sh" ||
      url.pathname === "/install.ps1" ||
      url.pathname === "/_headers"
    ) {
      return env.ASSETS.fetch(request);
    }

    // SPA fallback — serve index.html for all other paths (client-side routing)
    // Use no-cache to prevent CDN from caching stale HTML after redeployments
    const indexUrl = new URL("/index.html", url.origin);
    const indexRes = await env.ASSETS.fetch(new Request(indexUrl, request));
    const res = new Response(indexRes.body, indexRes);
    res.headers.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
    return res;
  },
};
