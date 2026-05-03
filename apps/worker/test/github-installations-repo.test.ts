// CRUD tests for github_installations against the workerd D1 binding.
//
// Uses the live D1 from cloudflare:test instead of mocking — the ON CONFLICT
// upsert and batch statements are tricky enough that mocking would just
// re-implement SQLite.

import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSchema } from "./fixtures/schema.js";
import {
  deleteInstallation,
  findInstallationById,
  findInstallationByRepo,
  setInstallationTenant,
  syncInstallationRepos,
  updateInstallationRepos,
  upsertInstallation,
} from "../src/github/installations-repo.js";

const DB = env.FP_DB;

async function reset(): Promise<void> {
  await DB.prepare("DELETE FROM github_installations").run();
  await DB.prepare("DELETE FROM tenants").run();
  // Seed the tenant IDs referenced by tests below; the FK is ON DELETE
  // SET NULL so these aren't strictly required, but a real D1 with
  // foreign_keys=ON would reject the inserts otherwise.
  await DB.prepare("INSERT OR IGNORE INTO tenants (id) VALUES ('tenant-x'), ('tenant-abc')").run();
}

describe("github_installations repo", () => {
  beforeAll(async () => {
    await bootstrapSchema(DB);
  });
  beforeEach(reset);

  it("upsertInstallation inserts a new row with parsed repos", async () => {
    await upsertInstallation(env, {
      installation_id: 1001,
      account_login: "octo",
      account_type: "Organization",
    });
    await syncInstallationRepos(env, 1001, [
      { id: 10, full_name: "octo/cat" },
      { id: 11, full_name: "octo/dog", default_branch: "main" },
    ]);

    const row = await findInstallationById(env, 1001);
    expect(row).not.toBeNull();
    expect(row!.account_login).toBe("octo");
    expect(row!.account_type).toBe("Organization");
    expect(row!.tenant_id).toBeNull();
    expect(row!.repos).toEqual([
      { id: 10, full_name: "octo/cat" },
      { id: 11, full_name: "octo/dog", default_branch: "main" },
    ]);
  });

  it("syncInstallationRepos replaces the full repo list on re-sync", async () => {
    // Realistic flow: install created → user claims tenant → GitHub fires
    // a metadata-only event. syncInstallationRepos is not called, so repos
    // are preserved.
    await upsertInstallation(env, {
      installation_id: 1002,
      account_login: "octo",
      account_type: "Organization",
    });
    await syncInstallationRepos(env, 1002, [{ id: 10, full_name: "octo/cat" }]);
    await setInstallationTenant(env, 1002, null); // simulate tenant claim later
    await DB.prepare(
      `UPDATE github_installations SET tenant_id = 'tenant-x' WHERE installation_id = 1002`,
    ).run();

    // Second installation event: upsertInstallation called without repos,
    // but syncInstallationRepos is also called (even if with empty) — in this
    // test we just verify the re-sync replaces rather than appends.
    await syncInstallationRepos(env, 1002, [{ id: 20, full_name: "octo/bird" }]);

    const row = await findInstallationById(env, 1002);
    expect(row!.tenant_id).toBe("tenant-x");
    expect(row!.repos).toEqual([{ id: 20, full_name: "octo/bird" }]);
  });

  it("syncInstallationRepos with empty repos clears the repo list", async () => {
    await upsertInstallation(env, {
      installation_id: 1011,
      account_login: "octo",
      account_type: "Organization",
    });
    await syncInstallationRepos(env, 1011, [{ id: 1, full_name: "octo/keep" }]);
    await syncInstallationRepos(env, 1011, []); // sync to empty

    const row = await findInstallationById(env, 1011);
    expect(row!.repos).toEqual([]);
  });

  it("updateInstallationRepos adds new repos and removes dropped ones", async () => {
    await upsertInstallation(env, {
      installation_id: 1003,
      account_login: "octo",
      account_type: "Organization",
    });
    await syncInstallationRepos(env, 1003, [
      { id: 10, full_name: "octo/cat" },
      { id: 11, full_name: "octo/dog" },
    ]);

    await updateInstallationRepos(
      env,
      1003,
      [{ id: 12, full_name: "octo/fish" }],
      [{ id: 11, full_name: "octo/dog" }],
    );

    const row = await findInstallationById(env, 1003);
    expect(row!.repos.map((r) => r.full_name).sort()).toEqual(["octo/cat", "octo/fish"]);
  });

  it("updateInstallationRepos is a no-op if the install row doesn't exist", async () => {
    // GitHub can fire installation_repositories before installation in
    // some race orderings; we shouldn't crash.
    await expect(
      updateInstallationRepos(env, 9999, [{ id: 1, full_name: "x/y" }], []),
    ).resolves.not.toThrow();
  });

  it("updateInstallationRepos is idempotent on duplicate add", async () => {
    await upsertInstallation(env, {
      installation_id: 1010,
      account_login: "octo",
      account_type: "Organization",
    });
    await updateInstallationRepos(env, 1010, [{ id: 1, full_name: "octo/dup" }], []);
    await updateInstallationRepos(env, 1010, [{ id: 1, full_name: "octo/dup" }], []); // replay

    const row = await findInstallationById(env, 1010);
    expect(row!.repos).toEqual([{ id: 1, full_name: "octo/dup" }]);
  });

  it("findInstallationByRepo locates the install owning a given full_name", async () => {
    await upsertInstallation(env, {
      installation_id: 1004,
      account_login: "octo",
      account_type: "Organization",
    });
    await syncInstallationRepos(env, 1004, [{ id: 20, full_name: "octo/find-me" }]);
    await upsertInstallation(env, {
      installation_id: 1005,
      account_login: "another",
      account_type: "User",
    });
    await syncInstallationRepos(env, 1005, [{ id: 21, full_name: "another/elsewhere" }]);

    const row = await findInstallationByRepo(env, "octo/find-me");
    expect(row?.installation_id).toBe(1004);

    const miss = await findInstallationByRepo(env, "noone/here");
    expect(miss).toBeNull();
  });

  it("setInstallationTenant claims and unclaims tenant_id", async () => {
    await upsertInstallation(env, {
      installation_id: 1006,
      account_login: "octo",
      account_type: "Organization",
    });
    await setInstallationTenant(env, 1006, "tenant-abc");
    expect((await findInstallationById(env, 1006))!.tenant_id).toBe("tenant-abc");
    await setInstallationTenant(env, 1006, null);
    expect((await findInstallationById(env, 1006))!.tenant_id).toBeNull();
  });

  it("deleteInstallation removes the row and is idempotent", async () => {
    await upsertInstallation(env, {
      installation_id: 1007,
      account_login: "octo",
      account_type: "User",
    });
    await deleteInstallation(env, 1007);
    expect(await findInstallationById(env, 1007)).toBeNull();
    // Second delete is a no-op, not an error.
    await expect(deleteInstallation(env, 1007)).resolves.not.toThrow();
  });
});
