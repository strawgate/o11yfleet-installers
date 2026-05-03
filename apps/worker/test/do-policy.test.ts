// Tests for the DO-local policy SQL boundary (loadDoPolicy / saveDoPolicy).
// Defense-in-depth: even if the schema layer is bypassed, the SQL boundary
// must reject obviously-bad values and surface drift.

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { ConfigDurableObject } from "../src/durable-objects/config-do.js";
import {
  isValidMaxAgents,
  isValidPositiveInt,
  loadDoPolicy,
  saveDoPolicy,
} from "../src/durable-objects/agent-state-repo.js";

function stubFor(name: string) {
  return env.CONFIG_DO.get(env.CONFIG_DO.idFromName(name));
}

describe("isValidPositiveInt / isValidMaxAgents (pure)", () => {
  it("isValidMaxAgents is an alias for isValidPositiveInt", () => {
    expect(isValidMaxAgents).toBe(isValidPositiveInt);
  });

  it.each([
    [1, true],
    [1000, true],
    [Number.MAX_SAFE_INTEGER, true],
    [0, false],
    [-1, false],
    [-100, false],
    [1.5, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    [Number.NEGATIVE_INFINITY, false],
    ["100", false],
    [null, false],
    [undefined, false],
    [{}, false],
    [true, false],
  ])("isValidMaxAgents(%p) === %p", (input, expected) => {
    expect(isValidMaxAgents(input)).toBe(expected);
  });
});

describe("saveDoPolicy / loadDoPolicy (DO-SQLite)", () => {
  it("round-trips a positive integer", async () => {
    const stub = stubFor("policy-round-trip:cfg");
    await stub.fetch(new Request("http://internal/init", { method: "POST" })); // ensures schema
    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        saveDoPolicy(state.storage.sql, { max_agents_per_config: 500 });
        const policy = loadDoPolicy(state.storage.sql);
        expect(policy.max_agents_per_config).toBe(500);
        expect(policy.auto_unenroll_after_days).toBe(30); // default
      },
    );
  });

  it("explicit null clears the cap", async () => {
    const stub = stubFor("policy-clear:cfg");
    await stub.fetch(new Request("http://internal/init", { method: "POST" }));
    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        saveDoPolicy(state.storage.sql, { max_agents_per_config: 100 });
        saveDoPolicy(state.storage.sql, { max_agents_per_config: null });
        expect(loadDoPolicy(state.storage.sql).max_agents_per_config).toBeNull();
      },
    );
  });

  it("rejects bad values at the SQL boundary (defense in depth)", async () => {
    const stub = stubFor("policy-defense:cfg");
    await stub.fetch(new Request("http://internal/init", { method: "POST" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        // Seed with a known-good value first.
        saveDoPolicy(state.storage.sql, { max_agents_per_config: 100 });
        // Now hammer the boundary with bad values — none should land.
        for (const bad of [-1, 0, 1.5, Number.NaN] as unknown as number[]) {
          saveDoPolicy(state.storage.sql, { max_agents_per_config: bad });
        }
        expect(loadDoPolicy(state.storage.sql).max_agents_per_config).toBe(100);
      },
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("loadDoPolicy logs and returns null on drift", async () => {
    const stub = stubFor("policy-drift:cfg");
    await stub.fetch(new Request("http://internal/init", { method: "POST" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        // Sneak a bad value past the boundary by writing SQL directly.
        // (Simulates "what if the column ever ended up holding garbage".)
        state.storage.sql.exec(`UPDATE do_config SET max_agents_per_config = -42 WHERE id = 1`);
        const policy = loadDoPolicy(state.storage.sql);
        expect(policy.max_agents_per_config).toBeNull();
      },
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("discarding"));
    warn.mockRestore();
  });

  it("auto_unenroll_after_days round-trips", async () => {
    const stub = stubFor("policy-unenroll-rt:cfg");
    await stub.fetch(new Request("http://internal/init", { method: "POST" }));
    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        saveDoPolicy(state.storage.sql, { auto_unenroll_after_days: 90 });
        expect(loadDoPolicy(state.storage.sql).auto_unenroll_after_days).toBe(90);
      },
    );
  });

  it("auto_unenroll_after_days null disables", async () => {
    const stub = stubFor("policy-unenroll-null:cfg");
    await stub.fetch(new Request("http://internal/init", { method: "POST" }));
    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        saveDoPolicy(state.storage.sql, { auto_unenroll_after_days: null });
        expect(loadDoPolicy(state.storage.sql).auto_unenroll_after_days).toBeNull();
      },
    );
  });

  it("saveDoPolicy rejects bad auto_unenroll_after_days values", async () => {
    const stub = stubFor("policy-unenroll-defense:cfg");
    await stub.fetch(new Request("http://internal/init", { method: "POST" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        saveDoPolicy(state.storage.sql, { auto_unenroll_after_days: 90 });
        for (const bad of [-1, 0, 1.5, Number.NaN] as unknown as number[]) {
          saveDoPolicy(state.storage.sql, { auto_unenroll_after_days: bad });
        }
        expect(loadDoPolicy(state.storage.sql).auto_unenroll_after_days).toBe(90);
      },
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("existing DOs get null (disabled) via migration, not 30", async () => {
    // Simulate an existing DO where the column was added via ALTER TABLE
    // (no DEFAULT). The CREATE TABLE path gives new DOs DEFAULT 30, but
    // ALTER TABLE ADD COLUMN without DEFAULT gives existing rows NULL.
    const stub = stubFor("policy-migration-null:cfg");
    await stub.fetch(new Request("http://internal/init", { method: "POST" }));
    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        // Simulate what ALTER TABLE without DEFAULT produces for existing rows
        state.storage.sql.exec(`UPDATE do_config SET auto_unenroll_after_days = NULL WHERE id = 1`);
        const policy = loadDoPolicy(state.storage.sql);
        expect(policy.auto_unenroll_after_days).toBeNull();
      },
    );
  });
});
