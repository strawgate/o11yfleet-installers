import { exports } from "cloudflare:workers";
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

  it("rejects malformed GitHub callbacks before exchanging tokens", async () => {
    const response = await exports.default.fetch("http://localhost/auth/github/callback");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing GitHub callback parameters" });
  });
});
