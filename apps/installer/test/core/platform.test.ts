/**
 * Tests for platform detection utilities.
 */

import { describe, it, expect } from "vitest";
import {
  detectPlatform,
  parseArch,
  parseOS,
  validateInstallDir,
  getSystemPaths,
  getDefaultInstallDir,
  getServiceName,
} from "../../src/core/platform.js";

describe("detectPlatform", () => {
  it("detects linux amd64", () => {
    const platform = detectPlatform("linux", "x86_64");
    expect(platform).toEqual({ os: "linux", arch: "amd64" });
  });

  it("detects linux arm64", () => {
    const platform = detectPlatform("linux", "aarch64");
    expect(platform).toEqual({ os: "linux", arch: "arm64" });
  });

  it("detects darwin amd64", () => {
    const platform = detectPlatform("darwin", "x86_64");
    expect(platform).toEqual({ os: "darwin", arch: "amd64" });
  });

  it("detects darwin arm64", () => {
    const platform = detectPlatform("darwin", "arm64");
    expect(platform).toEqual({ os: "darwin", arch: "arm64" });
  });

  it("detects windows", () => {
    const platform = detectPlatform("win32", "x64");
    expect(platform).toEqual({ os: "windows", arch: "amd64" });
  });

  it("defaults unknown platforms to linux", () => {
    const platform = detectPlatform("freebsd", "x86_64");
    expect(platform).toEqual({ os: "linux", arch: "amd64" });
  });
});

describe("parseArch", () => {
  it("parses x86_64 as amd64", () => {
    expect(parseArch("x86_64")).toBe("amd64");
  });

  it("parses amd64 as amd64", () => {
    expect(parseArch("amd64")).toBe("amd64");
  });

  it("parses aarch64 as arm64", () => {
    expect(parseArch("aarch64")).toBe("arm64");
  });

  it("parses arm64 as arm64", () => {
    expect(parseArch("arm64")).toBe("arm64");
  });

  it("defaults unknown architectures to amd64", () => {
    expect(parseArch("unknown")).toBe("amd64");
  });
});

describe("parseOS", () => {
  it("parses linux variants", () => {
    expect(parseOS("linux")).toBe("linux");
    expect(parseOS("Linux")).toBe("linux");
  });

  it("parses darwin variants", () => {
    expect(parseOS("darwin")).toBe("darwin");
    expect(parseOS("Darwin")).toBe("darwin");
  });

  it("parses windows variants", () => {
    expect(parseOS("windows")).toBe("windows");
    expect(parseOS("mingw")).toBe("windows");
    expect(parseOS("cygwin")).toBe("windows");
  });

  it("defaults unknown to linux", () => {
    expect(parseOS("freebsd")).toBe("linux");
  });
});

describe("validateInstallDir", () => {
  it("accepts valid linux paths", () => {
    expect(validateInstallDir("/opt/o11yfleet", "linux")).toBe(true);
    expect(validateInstallDir("/usr/local/o11y", "linux")).toBe(true);
    expect(validateInstallDir("/home/user/o11y", "linux")).toBe(true);
  });

  it("rejects dangerous paths on linux", () => {
    expect(validateInstallDir("/", "linux")).toBe(false);
    expect(validateInstallDir("/home", "linux")).toBe(false);
    expect(validateInstallDir("/root", "linux")).toBe(false);
    expect(validateInstallDir("/tmp", "linux")).toBe(false);
  });

  it("accepts valid windows paths", () => {
    expect(validateInstallDir("C:\\Program Files\\O11yFleet", "windows")).toBe(true);
    expect(validateInstallDir("D:\\Apps\\O11yFleet", "windows")).toBe(true);
  });

  it("rejects windows paths without drive letter", () => {
    expect(validateInstallDir("\\Program Files\\O11yFleet", "windows")).toBe(false);
    expect(validateInstallDir("Program Files\\O11yFleet", "windows")).toBe(false);
  });
});

describe("getSystemPaths", () => {
  it("includes common paths for linux", () => {
    const paths = getSystemPaths("/home/user", "linux");
    expect(paths).toContain("/usr/local/bin");
    expect(paths).toContain("/usr/bin");
    expect(paths).toContain("/opt");
  });

  it("includes homebrew paths for darwin", () => {
    const paths = getSystemPaths("/Users/user", "darwin");
    expect(paths).toContain("/opt/homebrew/bin");
  });

  it("includes Program Files for windows", () => {
    const paths = getSystemPaths("C:\\Users\\user", "windows");
    expect(paths).toContain("C:\\Program Files");
  });
});

describe("getDefaultInstallDir", () => {
  it("returns /opt/o11yfleet for linux", () => {
    expect(getDefaultInstallDir("linux")).toBe("/opt/o11yfleet");
  });

  it("returns /opt/o11yfleet for darwin", () => {
    expect(getDefaultInstallDir("darwin")).toBe("/opt/o11yfleet");
  });

  it("returns correct path for windows", () => {
    expect(getDefaultInstallDir("windows")).toBe("C:\\Program Files\\O11yFleet");
  });
});

describe("getServiceName", () => {
  it("returns systemd name for linux", () => {
    expect(getServiceName("linux")).toBe("o11yfleet-collector");
  });

  it("returns launchd name for darwin", () => {
    expect(getServiceName("darwin")).toBe("com.o11yfleet.collector");
  });

  it("returns windows name for windows", () => {
    expect(getServiceName("windows")).toBe("o11yfleet-collector");
  });
});
