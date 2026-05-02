import { env, exports } from "cloudflare:workers";
import { base64urlDecode } from "@o11yfleet/core/auth";
import { describe, expect, it } from "vitest";

describe("GitHub social auth", () => {
  it("redirects to GitHub with signed state for social login", async () => {
    const response = await exports.default.fetch(
      "http://localhost/auth/github/start?mode=signup&plan=pro&site_origin=http%3A%2F%2Flocalhost%3A4000",
      { redirect: "manual" },
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location).toContain("https://github.com/login/oauth/authorize?");
    expect(location).toContain("client_id=test-github-client-id");
    expect(location).toContain("redirect_uri=http%3A%2F%2Flocalhost%2Fauth%2Fgithub%2Fcallback");
    expect(location).toContain("state=");
    expect(response.headers.get("Set-Cookie")).toContain("fp_oauth_state=");
  });

  it("accepts Terraform-managed static site Worker origins", async () => {
    const previousEnvironment = env.ENVIRONMENT;
    env.ENVIRONMENT = "staging";
    const siteOrigin = "https://o11yfleet-site-worker-staging.o11yfleet.workers.dev";
    try {
      const response = await exports.default.fetch(
        `http://localhost/auth/github/start?mode=login&site_origin=${encodeURIComponent(siteOrigin)}`,
        { redirect: "manual" },
      );

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("Location") ?? "");
      const state = location.searchParams.get("state") ?? "";
      const [payload] = state.split(".");
      const decoded = JSON.parse(new TextDecoder().decode(base64urlDecode(payload!))) as {
        returnTo: string;
      };
      expect(decoded.returnTo).toBe(`${siteOrigin}/portal/overview`);
    } finally {
      env.ENVIRONMENT = previousEnvironment;
    }
  });

  it("accepts app and admin custom site origins for the active environment", async () => {
    const previousEnvironment = env.ENVIRONMENT;
    const cases = [
      {
        environment: "production",
        origins: ["https://app.o11yfleet.com", "https://admin.o11yfleet.com"],
      },
      {
        environment: "staging",
        origins: ["https://staging-app.o11yfleet.com", "https://staging-admin.o11yfleet.com"],
      },
      {
        environment: "dev",
        origins: ["https://dev-app.o11yfleet.com", "https://dev-admin.o11yfleet.com"],
      },
    ] as const;

    try {
      for (const testCase of cases) {
        env.ENVIRONMENT = testCase.environment;
        for (const siteOrigin of testCase.origins) {
          const response = await exports.default.fetch(
            `http://localhost/auth/github/start?mode=login&site_origin=${encodeURIComponent(siteOrigin)}`,
            { redirect: "manual" },
          );

          expect(response.status).toBe(302);
          const location = new URL(response.headers.get("Location") ?? "");
          const state = location.searchParams.get("state") ?? "";
          const [payload] = state.split(".");
          const decoded = JSON.parse(new TextDecoder().decode(base64urlDecode(payload!))) as {
            returnTo: string;
          };
          expect(decoded.returnTo).toBe(`${siteOrigin}/portal/overview`);
        }
      }
    } finally {
      env.ENVIRONMENT = previousEnvironment;
    }
  });

  it("normalizes explicit site_origin values to their origin", async () => {
    const response = await exports.default.fetch(
      `http://localhost/auth/github/start?mode=login&site_origin=${encodeURIComponent("https://dev-app.o11yfleet.com/portal/agents?tab=all")}`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location") ?? "");
    const state = location.searchParams.get("state") ?? "";
    const [payload] = state.split(".");
    const decoded = JSON.parse(new TextDecoder().decode(base64urlDecode(payload!))) as {
      returnTo: string;
    };
    expect(decoded.returnTo).toBe("https://dev-app.o11yfleet.com/portal/overview");
  });

  it("rejects cross-environment custom site origins", async () => {
    const previousEnvironment = env.ENVIRONMENT;
    env.ENVIRONMENT = "dev";
    try {
      const response = await exports.default.fetch(
        `http://localhost/auth/github/start?mode=login&site_origin=${encodeURIComponent("https://staging-app.o11yfleet.com")}`,
        { redirect: "manual" },
      );

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("Location") ?? "");
      const state = location.searchParams.get("state") ?? "";
      const [payload] = state.split(".");
      const decoded = JSON.parse(new TextDecoder().decode(base64urlDecode(payload!))) as {
        returnTo: string;
      };
      expect(decoded.returnTo).toBe("http://localhost:4000/portal/overview");
    } finally {
      env.ENVIRONMENT = previousEnvironment;
    }
  });

  it("falls back to production site origins for unknown environments", async () => {
    const previousEnvironment = env.ENVIRONMENT;
    env.ENVIRONMENT = "preview" as typeof env.ENVIRONMENT;
    try {
      const response = await exports.default.fetch(
        `http://localhost/auth/github/start?mode=login&site_origin=${encodeURIComponent("https://dev-app.o11yfleet.com")}`,
        { redirect: "manual" },
      );

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("Location") ?? "");
      const state = location.searchParams.get("state") ?? "";
      const [payload] = state.split(".");
      const decoded = JSON.parse(new TextDecoder().decode(base64urlDecode(payload!))) as {
        returnTo: string;
      };
      expect(decoded.returnTo).toBe("https://o11yfleet.com/portal/overview");
    } finally {
      env.ENVIRONMENT = previousEnvironment;
    }
  });

  it("renders the GitHub App manifest creation form", async () => {
    const response = await exports.default.fetch(
      "http://localhost/auth/github/app-manifest?site_origin=http%3A%2F%2Flocalhost%3A4000",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Set-Cookie")).toContain("fp_oauth_state=");
    const body = await response.text();
    expect(body).toContain("https://github.com/settings/apps/new?state=");
    expect(body).toContain("/auth/github/app-manifest/callback");
    expect(body).toContain("hook_attributes");
    expect(body).toContain("active");
    expect(body).toContain("email_addresses");
    expect(body).toContain("read");
  });

  it("includes the GitOps + check-run permission set in the served manifest", async () => {
    // Regression-guards the perm set declared in infra/github-app/o11yfleet.json.
    // Adding a permission here forces re-approval on every install, so we want
    // a test that fails loudly if the manifest drifts unintentionally.
    const response = await exports.default.fetch(
      "http://localhost/auth/github/app-manifest?site_origin=http%3A%2F%2Flocalhost%3A4000",
    );

    const body = await response.text();
    // Extract the manifest JSON from the hidden form field.
    const m = body.match(/name="manifest" value="([^"]*)"/);
    expect(m, "expected hidden manifest input in form").toBeTruthy();
    const manifestJson = m![1]!
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    const manifest = JSON.parse(manifestJson) as {
      default_permissions: Record<string, string>;
      default_events: string[];
      hook_attributes: { url: string; active: boolean };
    };

    // Exact equality, not toMatchObject — a silently-added permission would
    // otherwise slip through, which defeats the whole point of pinning the
    // scope here. Adding a perm forces re-approval on every install, so it
    // must be an explicit code change to this assertion too.
    expect(manifest.default_permissions).toEqual({
      email_addresses: "read",
      metadata: "read",
      contents: "read",
      commit_statuses: "write",
      deployments: "write",
      pull_requests: "write",
      checks: "write",
    });
    expect(manifest.default_events).toEqual([
      "push",
      "pull_request",
      "installation",
      "installation_repositories",
    ]);
    // Webhook handler is live as of #510 — receives at POST /auth/github/webhook
    // with HMAC verification. active: true means a freshly-bootstrapped app
    // starts delivering events immediately.
    expect(manifest.hook_attributes.active).toBe(true);
    expect(manifest.hook_attributes.url).toMatch(/\/auth\/github\/webhook$/);
  });

  it("rejects malformed GitHub callbacks before exchanging tokens", async () => {
    const response = await exports.default.fetch("http://localhost/auth/github/callback");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing GitHub callback parameters" });
  });
});
