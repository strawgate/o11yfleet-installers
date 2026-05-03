// Pure-function tests for the manifest drift diff. The cron entry point
// (network call + JWT mint) is exercised separately when staging hits
// the live App; the diff itself is pure and deterministic.

import { describe, expect, it } from "vitest";
import { assertManifestShape, diffManifestAgainstLive } from "../src/jobs/manifest-drift-check.js";

const baseManifest = {
  default_permissions: {
    contents: "read",
    checks: "write",
    metadata: "read",
  },
  default_events: ["push", "pull_request"],
};

describe("diffManifestAgainstLive", () => {
  it("returns noDrift when permissions and events match exactly", () => {
    const report = diffManifestAgainstLive(baseManifest, {
      permissions: { contents: "read", checks: "write", metadata: "read" },
      events: ["push", "pull_request"],
    });
    expect(report.noDrift).toBe(true);
    expect(report.permissionsAddedInManifest).toEqual({});
    expect(report.permissionsChanged).toEqual({});
    expect(report.permissionsRemovedFromManifest).toEqual({});
    expect(report.eventsAddedInManifest).toEqual([]);
    expect(report.eventsRemovedFromManifest).toEqual([]);
  });

  it("flags permissions present in manifest but missing on live App", () => {
    const report = diffManifestAgainstLive(baseManifest, {
      permissions: { contents: "read", metadata: "read" }, // no `checks`
      events: ["push", "pull_request"],
    });
    expect(report.noDrift).toBe(false);
    expect(report.permissionsAddedInManifest).toEqual({ checks: "write" });
  });

  it("flags permission level changes (e.g. read → write or vice versa)", () => {
    const report = diffManifestAgainstLive(baseManifest, {
      permissions: { contents: "write", checks: "write", metadata: "read" },
      events: ["push", "pull_request"],
    });
    expect(report.noDrift).toBe(false);
    expect(report.permissionsChanged).toEqual({
      contents: { manifest: "read", live: "write" },
    });
  });

  it("flags permissions on live App that the manifest doesn't declare", () => {
    // Common cause: someone added a permission via the web UI for an
    // experiment and forgot to mirror it back to the manifest.
    const report = diffManifestAgainstLive(baseManifest, {
      permissions: { contents: "read", checks: "write", metadata: "read", issues: "write" },
      events: ["push", "pull_request"],
    });
    expect(report.noDrift).toBe(false);
    expect(report.permissionsRemovedFromManifest).toEqual({ issues: "write" });
  });

  it("flags events declared in manifest but absent on live App", () => {
    const report = diffManifestAgainstLive(baseManifest, {
      permissions: baseManifest.default_permissions,
      events: ["push"], // missing pull_request
    });
    expect(report.noDrift).toBe(false);
    expect(report.eventsAddedInManifest).toEqual(["pull_request"]);
  });

  it("flags events on live App that the manifest doesn't declare", () => {
    const report = diffManifestAgainstLive(baseManifest, {
      permissions: baseManifest.default_permissions,
      events: ["push", "pull_request", "release"],
    });
    expect(report.noDrift).toBe(false);
    expect(report.eventsRemovedFromManifest).toEqual(["release"]);
  });

  it("handles a live response missing the permissions/events fields", () => {
    // Defensive: GitHub's response could omit fields if the App has none
    // (very unlikely, but the diff shouldn't NPE either way).
    const report = diffManifestAgainstLive(baseManifest, {});
    expect(report.noDrift).toBe(false);
    expect(report.permissionsAddedInManifest).toEqual(baseManifest.default_permissions);
    expect(report.eventsAddedInManifest).toEqual([...baseManifest.default_events]);
  });

  it("aggregates multiple kinds of drift in one report (sanity)", () => {
    const report = diffManifestAgainstLive(baseManifest, {
      permissions: {
        // contents: missing
        checks: "read", // changed: write → read
        metadata: "read",
        deployments: "write", // extra
      },
      events: ["push", "release"], // pull_request missing, release extra
    });
    expect(report.noDrift).toBe(false);
    expect(report.permissionsAddedInManifest).toEqual({ contents: "read" });
    expect(report.permissionsChanged).toEqual({
      checks: { manifest: "write", live: "read" },
    });
    expect(report.permissionsRemovedFromManifest).toEqual({ deployments: "write" });
    expect(report.eventsAddedInManifest).toEqual(["pull_request"]);
    expect(report.eventsRemovedFromManifest).toEqual(["release"]);
  });
});

describe("assertManifestShape", () => {
  it("accepts the expected manifest shape", () => {
    expect(() =>
      assertManifestShape({
        default_permissions: { contents: "read", checks: "write" },
        default_events: ["push", "pull_request"],
      }),
    ).not.toThrow();
  });

  it("throws when value is not an object", () => {
    expect(() => assertManifestShape(null)).toThrow(/not an object/);
    expect(() => assertManifestShape("manifest")).toThrow(/not an object/);
    expect(() => assertManifestShape(42)).toThrow(/not an object/);
  });

  it("throws when default_permissions is missing or wrong-shaped", () => {
    expect(() => assertManifestShape({ default_events: [] })).toThrow(
      /default_permissions is missing/,
    );
    expect(() =>
      assertManifestShape({ default_permissions: "not-an-object", default_events: [] }),
    ).toThrow(/default_permissions is missing or not an object/);
  });

  it("throws when a permission level is not a string", () => {
    expect(() =>
      assertManifestShape({
        default_permissions: { contents: 1 },
        default_events: [],
      }),
    ).toThrow(/default_permissions\.contents is not a string/);
  });

  it("throws when default_events is missing or not an array", () => {
    expect(() => assertManifestShape({ default_permissions: {} })).toThrow(
      /default_events is missing or not an array/,
    );
    expect(() =>
      assertManifestShape({ default_permissions: {}, default_events: "push,pull_request" }),
    ).toThrow(/default_events is missing or not an array/);
  });

  it("throws when an event entry is not a string", () => {
    expect(() =>
      assertManifestShape({
        default_permissions: {},
        default_events: ["push", 42],
      }),
    ).toThrow(/default_events contains a non-string entry/);
  });
});
