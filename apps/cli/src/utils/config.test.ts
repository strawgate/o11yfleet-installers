import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let homeDir: string;

async function loadConfigModule() {
  vi.resetModules();
  vi.stubEnv("HOME", homeDir);
  vi.stubEnv("O11YFLEET_API_URL", "");
  return import("./config.js");
}

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "ofleet-config-test-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(homeDir, { recursive: true, force: true });
});

describe("config storage", () => {
  it("loadAuth returns defaults when no auth file exists", async () => {
    const { loadAuth } = await loadConfigModule();
    const auth = await loadAuth();

    expect(auth.apiUrl).toBe("http://localhost:8787");
    expect(auth.sessionCookie).toBeUndefined();
    expect(auth.tenantId).toBeUndefined();
    expect(auth.token).toBeUndefined();
  });

  it("migrates auth from the old o11y config directory", async () => {
    const legacyDir = join(homeDir, ".config", "o11y");
    const legacyAuth = join(legacyDir, "auth.json");
    await rm(legacyDir, { recursive: true, force: true });
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      legacyAuth,
      JSON.stringify({
        apiUrl: "https://api.example.com",
        sessionCookie: "session=abc",
        tenantId: "tenant_123",
        token: "token_123",
      }),
    );

    const { loadAuth } = await loadConfigModule();
    const auth = await loadAuth();
    const migratedAuth = join(homeDir, ".config", "ofleet", "auth.json");

    expect(auth).toEqual({
      apiUrl: "https://api.example.com",
      sessionCookie: "session=abc",
      tenantId: "tenant_123",
      token: "token_123",
    });
    expect(existsSync(legacyAuth)).toBe(true);
    expect(JSON.parse(await readFile(migratedAuth, "utf-8"))).toEqual(auth);
    expect(statSync(migratedAuth).mode & 0o777).toBe(0o600);
  });

  it("does not overwrite existing ofleet auth with legacy auth", async () => {
    const legacyDir = join(homeDir, ".config", "o11y");
    const currentDir = join(homeDir, ".config", "ofleet");
    await Promise.all([
      mkdir(legacyDir, { recursive: true }),
      mkdir(currentDir, { recursive: true }),
    ]);
    await writeFile(
      join(legacyDir, "auth.json"),
      JSON.stringify({ apiUrl: "https://old.example.com", token: "old-token" }),
    );
    await writeFile(
      join(currentDir, "auth.json"),
      JSON.stringify({ apiUrl: "https://new.example.com", token: "new-token" }),
    );

    const { loadAuth } = await loadConfigModule();
    const auth = await loadAuth();

    expect(auth.apiUrl).toBe("https://new.example.com");
    expect(auth.token).toBe("new-token");
  });

  it("migrates only missing files from the old o11y config directory", async () => {
    const legacyDir = join(homeDir, ".config", "o11y");
    const currentDir = join(homeDir, ".config", "ofleet");
    await Promise.all([
      mkdir(legacyDir, { recursive: true }),
      mkdir(currentDir, { recursive: true }),
    ]);
    await writeFile(
      join(legacyDir, "auth.json"),
      JSON.stringify({ apiUrl: "https://old.example.com", token: "old-token" }),
    );
    await writeFile(
      join(legacyDir, "config.json"),
      JSON.stringify({ apiUrl: "https://legacy.example.com", defaultTenant: "tenant_legacy" }),
    );
    await writeFile(
      join(currentDir, "auth.json"),
      JSON.stringify({ apiUrl: "https://current.example.com", token: "current-token" }),
    );

    const { loadAuth, loadConfig } = await loadConfigModule();
    const auth = await loadAuth();
    const config = await loadConfig();
    const migratedConfig = join(currentDir, "config.json");

    expect(auth.apiUrl).toBe("https://current.example.com");
    expect(auth.token).toBe("current-token");
    expect(config).toEqual({
      apiUrl: "https://legacy.example.com",
      defaultTenant: "tenant_legacy",
    });
    expect(JSON.parse(await readFile(migratedConfig, "utf-8"))).toEqual(config);
  });

  it("migrates global config from the old o11y config directory", async () => {
    const legacyDir = join(homeDir, ".config", "o11y");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      join(legacyDir, "config.json"),
      JSON.stringify({ apiUrl: "https://api.example.com", defaultTenant: "tenant_123" }),
    );

    const { loadConfig } = await loadConfigModule();
    const config = await loadConfig();
    const migratedConfig = join(homeDir, ".config", "ofleet", "config.json");

    expect(config).toEqual({
      apiUrl: "https://api.example.com",
      defaultTenant: "tenant_123",
    });
    expect(JSON.parse(await readFile(migratedConfig, "utf-8"))).toEqual(config);
    expect(statSync(migratedConfig).mode & 0o777).toBe(0o644);
  });
});
