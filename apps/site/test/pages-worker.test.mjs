import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../public/_worker.js";

const currentIndex = `<!doctype html><div id="root"></div><script src="/assets/index-current.js"></script>`;
const stalePortal = `<!doctype html><link rel="stylesheet" href="../portal-shared.css"><div>Prototype — AI Insights</div>`;
const docsPage = `<!doctype html><main>Docs page</main>`;

function envWithAssets() {
  const seen = [];
  return {
    seen,
    env: {
      ASSETS: {
        async fetch(request) {
          const url = new URL(request.url);
          seen.push(url.pathname);
          if (url.pathname === "/") {
            return new Response(currentIndex, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
          if (url.pathname === "/portal/overview") {
            return new Response(stalePortal, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
          if (url.pathname === "/docs/") {
            return new Response(docsPage, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
          if (url.pathname === "/assets/index-current.js") {
            return new Response("console.log('current')", {
              headers: { "Content-Type": "text/javascript" },
            });
          }
          return new Response("missing", { status: 404 });
        },
      },
    },
  };
}

test("serves the current SPA index for clean portal routes even when stale assets exist", async () => {
  const { env, seen } = envWithAssets();

  const response = await worker.fetch(
    new Request("https://app.o11yfleet.com/portal/overview"),
    env,
  );
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /id="root"/);
  assert.doesNotMatch(text, /Prototype/);
  assert.deepEqual(seen, ["/"]);
});

test("redirects environment-specific app and admin roots", async () => {
  const app = envWithAssets();
  const appResponse = await worker.fetch(
    new Request("https://staging-app.o11yfleet.com/"),
    app.env,
  );
  assert.equal(appResponse.status, 302);
  assert.equal(
    appResponse.headers.get("location"),
    "https://staging-app.o11yfleet.com/portal/overview",
  );

  const admin = envWithAssets();
  const adminResponse = await worker.fetch(
    new Request("https://dev-admin.o11yfleet.com/"),
    admin.env,
  );
  assert.equal(adminResponse.status, 302);
  assert.equal(
    adminResponse.headers.get("location"),
    "https://dev-admin.o11yfleet.com/admin/overview",
  );

  const pagesApp = envWithAssets();
  const pagesAppResponse = await worker.fetch(
    new Request("https://o11yfleet-staging-app.pages.dev/"),
    pagesApp.env,
  );
  assert.equal(pagesAppResponse.status, 302);
  assert.equal(
    pagesAppResponse.headers.get("location"),
    "https://o11yfleet-staging-app.pages.dev/portal/overview",
  );

  const pagesAdmin = envWithAssets();
  const pagesAdminResponse = await worker.fetch(
    new Request("https://o11yfleet-dev-admin.pages.dev/"),
    pagesAdmin.env,
  );
  assert.equal(pagesAdminResponse.status, 302);
  assert.equal(
    pagesAdminResponse.headers.get("location"),
    "https://o11yfleet-dev-admin.pages.dev/admin/overview",
  );
});

test("continues serving docs and static assets directly", async () => {
  const docs = envWithAssets();
  const docsResponse = await worker.fetch(new Request("https://o11yfleet.com/docs/"), docs.env);

  assert.equal(await docsResponse.text(), docsPage);
  assert.deepEqual(docs.seen, ["/docs/"]);

  const asset = envWithAssets();
  const assetResponse = await worker.fetch(
    new Request("https://o11yfleet.com/assets/index-current.js"),
    asset.env,
  );

  assert.equal(await assetResponse.text(), "console.log('current')");
  assert.deepEqual(asset.seen, ["/assets/index-current.js"]);
});
