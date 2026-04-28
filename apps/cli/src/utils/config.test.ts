import { describe, it, expect, vi } from "vitest";

describe("config storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loadAuth returns defaults when no auth file exists", async () => {
    vi.mock("node:fs/promises", () => ({
      existsSync: vi.fn().mockReturnValue(false),
      mkdir: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      rename: vi.fn(),
      chmod: vi.fn(),
    }));

    const { loadAuth } = await import("./config.js");
    const auth = await loadAuth();

    expect(auth.apiUrl).toBeDefined();
    expect(auth.sessionCookie).toBeUndefined();
    expect(auth.tenantId).toBeUndefined();
  });
});
