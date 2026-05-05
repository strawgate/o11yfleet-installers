/**
 * Tests for URL building utilities.
 */

import { describe, it, expect } from "vitest";
import {
  buildOtelFilename,
  parseOtelFilename,
  buildOpampEndpoint,
  getOtelAsset,
  getDefaultOtelVersion,
  isValidVersion,
  getAssetForVersion,
} from "../../src/core/urls.js";

describe("buildOtelFilename", () => {
  it("builds linux amd64 filename", () => {
    const filename = buildOtelFilename("0.114.0", { os: "linux", arch: "amd64" });
    expect(filename).toBe("otelcol-contrib_0.114.0_linux_amd64.tar.gz");
  });

  it("builds linux arm64 filename", () => {
    const filename = buildOtelFilename("0.151.0", { os: "linux", arch: "arm64" });
    expect(filename).toBe("otelcol-contrib_0.151.0_linux_arm64.tar.gz");
  });

  it("builds darwin amd64 filename", () => {
    const filename = buildOtelFilename("0.114.0", { os: "darwin", arch: "amd64" });
    expect(filename).toBe("otelcol-contrib_0.114.0_darwin_amd64.tar.gz");
  });

  it("builds darwin arm64 filename", () => {
    const filename = buildOtelFilename("0.114.0", { os: "darwin", arch: "arm64" });
    expect(filename).toBe("otelcol-contrib_0.114.0_darwin_arm64.tar.gz");
  });

  it("builds windows amd64 filename with zip extension", () => {
    const filename = buildOtelFilename("0.114.0", { os: "windows", arch: "amd64" });
    expect(filename).toBe("otelcol-contrib_0.114.0_windows_amd64.zip");
  });

  it("builds windows arm64 filename with zip extension", () => {
    const filename = buildOtelFilename("0.151.0", { os: "windows", arch: "arm64" });
    expect(filename).toBe("otelcol-contrib_0.151.0_windows_arm64.zip");
  });
});

describe("parseOtelFilename", () => {
  it("parses valid linux filename", () => {
    const result = parseOtelFilename("otelcol-contrib_0.114.0_linux_amd64.tar.gz");
    expect(result).toEqual({
      filename: "otelcol-contrib_0.114.0_linux_amd64.tar.gz",
      version: "0.114.0",
      os: "linux",
      arch: "amd64",
      ext: "tar.gz",
    });
  });

  it("parses valid darwin filename", () => {
    const result = parseOtelFilename("otelcol-contrib_0.151.0_darwin_arm64.tar.gz");
    expect(result).toEqual({
      filename: "otelcol-contrib_0.151.0_darwin_arm64.tar.gz",
      version: "0.151.0",
      os: "darwin",
      arch: "arm64",
      ext: "tar.gz",
    });
  });

  it("parses valid windows filename", () => {
    const result = parseOtelFilename("otelcol-contrib_0.114.0_windows_amd64.zip");
    expect(result).toEqual({
      filename: "otelcol-contrib_0.114.0_windows_amd64.zip",
      version: "0.114.0",
      os: "windows",
      arch: "amd64",
      ext: "zip",
    });
  });

  it("returns null for invalid filename", () => {
    expect(parseOtelFilename("invalid")).toBeNull();
    expect(parseOtelFilename("otelcol_0.114.0_linux_amd64.tar.gz")).toBeNull();
    expect(parseOtelFilename("otelcol-contrib_v0.114.0_linux_amd64.tar.gz")).toBeNull();
  });

  it("returns null for unsupported OS", () => {
    expect(parseOtelFilename("otelcol-contrib_0.114.0_freebsd_amd64.tar.gz")).toBeNull();
  });
});

describe("buildOpampEndpoint", () => {
  it("uses default endpoint when none provided", () => {
    const endpoint = buildOpampEndpoint();
    expect(endpoint).toBe("wss://api.o11yfleet.com/v1/opamp");
  });

  it("adds /v1/opamp path", () => {
    const endpoint = buildOpampEndpoint("wss://custom.example.com");
    expect(endpoint).toBe("wss://custom.example.com/v1/opamp");
  });

  it("removes trailing slash", () => {
    const endpoint = buildOpampEndpoint("wss://custom.example.com/");
    expect(endpoint).toBe("wss://custom.example.com/v1/opamp");
  });

  it("converts https to wss", () => {
    const endpoint = buildOpampEndpoint("https://custom.example.com");
    expect(endpoint).toBe("wss://custom.example.com/v1/opamp");
  });

  it("keeps ws as-is", () => {
    const endpoint = buildOpampEndpoint("ws://custom.example.com");
    expect(endpoint).toBe("ws://custom.example.com/v1/opamp");
  });
});

describe("getOtelAsset", () => {
  it("returns correct asset for linux amd64", () => {
    const asset = getOtelAsset("0.114.0", { os: "linux", arch: "amd64" });
    expect(asset.filename).toBe("otelcol-contrib_0.114.0_linux_amd64.tar.gz");
    expect(asset.url).toContain("github.com/open-telemetry/opentelemetry-collector-releases");
    expect(asset.url).toContain("v0.114.0");
    expect(asset.checksumUrl).toContain("checksums.txt");
  });

  it("returns correct asset for windows", () => {
    const asset = getOtelAsset("0.151.0", { os: "windows", arch: "arm64" });
    expect(asset.filename).toBe("otelcol-contrib_0.151.0_windows_arm64.zip");
  });
});

describe("getDefaultOtelVersion", () => {
  it("returns a valid version string", () => {
    const version = getDefaultOtelVersion();
    expect(isValidVersion(version)).toBe(true);
  });
});

describe("isValidVersion", () => {
  it("accepts valid semver versions", () => {
    expect(isValidVersion("0.114.0")).toBe(true);
    expect(isValidVersion("0.151.0")).toBe(true);
    expect(isValidVersion("1.0.0")).toBe(true);
    expect(isValidVersion("10.20.30")).toBe(true);
  });

  it("rejects invalid versions", () => {
    expect(isValidVersion("")).toBe(false);
    expect(isValidVersion("v0.114.0")).toBe(false);
    expect(isValidVersion("0.114")).toBe(false);
    expect(isValidVersion("latest")).toBe(false);
    expect(isValidVersion("0.114.0-beta")).toBe(false);
  });
});

describe("getAssetForVersion", () => {
  it("returns asset for valid version", () => {
    const asset = getAssetForVersion("0.114.0", { os: "linux", arch: "amd64" });
    expect(asset).not.toBeNull();
    expect(asset?.filename).toBe("otelcol-contrib_0.114.0_linux_amd64.tar.gz");
  });

  it("returns null for invalid version", () => {
    const asset = getAssetForVersion("invalid", { os: "linux", arch: "amd64" });
    expect(asset).toBeNull();
  });
});
