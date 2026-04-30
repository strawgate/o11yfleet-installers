import assert from "node:assert/strict";
import { test } from "node:test";
import {
  portalBreadcrumbConfigurationId,
  portalBreadcrumbLabel,
} from "../src/layouts/portal-breadcrumbs";

test("uses configuration name for configuration detail breadcrumbs", () => {
  const configId = "ad239896-93fe-415d-9acf-1c77b5d2362b";
  const segments = ["configurations", configId];

  assert.equal(portalBreadcrumbConfigurationId(`/portal/configurations/${configId}`), configId);
  assert.equal(
    portalBreadcrumbLabel(configId, 1, segments, {
      configurationId: configId,
      configurationName: "test-config",
    }),
    "test-config",
  );
  assert.equal(
    portalBreadcrumbConfigurationId(`/portal/configurations/${configId}/agents`),
    configId,
  );
});

test("does not treat static configuration routes as configuration ids", () => {
  assert.equal(portalBreadcrumbConfigurationId("/portal/configurations/new"), undefined);
  assert.equal(portalBreadcrumbConfigurationId("/portal/configurations/not-a-config"), undefined);
});

test("falls back to readable static portal breadcrumb labels", () => {
  assert.equal(portalBreadcrumbLabel("getting-started", 0, ["getting-started"]), "Getting Started");
});

test("handles malformed URI segments without throwing", () => {
  assert.equal(portalBreadcrumbLabel("%E0%A4%A", 0, ["%E0%A4%A"]), "%E0%A4%A");
  assert.equal(portalBreadcrumbConfigurationId("/portal/configurations/%E0%A4%A"), undefined);
});
