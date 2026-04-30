// Cloudflare Pages Function — subdomain routing + SPA fallback
// app-style hosts redirect root to /portal/overview.
// admin-style hosts redirect root to /admin/overview.
// site-style hosts serve the marketing/docs SPA.

// Known static asset prefixes/extensions that should be served directly
const STATIC_ASSET_RE =
  /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|json|txt|xml|webmanifest)$/;

function shouldServeAssetDirectly(pathname) {
  if (STATIC_ASSET_RE.test(pathname)) return true;
  if (pathname === "/install.sh" || pathname === "/install.ps1" || pathname === "/_headers") {
    return true;
  }
  return pathname === "/docs" || pathname.startsWith("/docs/");
}

function rootRedirectPath(host) {
  if (
    host === "app.o11yfleet.com" ||
    host === "staging-app.o11yfleet.com" ||
    host === "dev-app.o11yfleet.com" ||
    host.startsWith("o11yfleet-app.") ||
    host.startsWith("o11yfleet-staging-app.") ||
    host.startsWith("o11yfleet-dev-app.")
  ) {
    return "/portal/overview";
  }
  if (
    host === "admin.o11yfleet.com" ||
    host === "staging-admin.o11yfleet.com" ||
    host === "dev-admin.o11yfleet.com" ||
    host.startsWith("o11yfleet-admin.") ||
    host.startsWith("o11yfleet-staging-admin.") ||
    host.startsWith("o11yfleet-dev-admin.")
  ) {
    return "/admin/overview";
  }
  return null;
}

async function serveSpaIndex(request, env) {
  const url = new URL(request.url);
  const rootReq = new Request(new URL("/", url.origin), {
    method: "GET",
    headers: request.headers,
  });
  const rootRes = await env.ASSETS.fetch(rootReq);
  const res = new Response(rootRes.body, rootRes);
  res.headers.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
  return res;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname;

    const redirectPath = rootRedirectPath(host);
    if (redirectPath && (url.pathname === "/" || url.pathname === "")) {
      return Response.redirect(new URL(redirectPath, url.origin).toString(), 302);
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
    if (shouldServeAssetDirectly(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    // SPA routes must always serve the current React index. Cloudflare Pages can
    // keep old clean-route HTML assets addressable after deploys, so fetching the
    // original path first can resurrect removed prototype pages.
    return serveSpaIndex(request, env);
  },
};
