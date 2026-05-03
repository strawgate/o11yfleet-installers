// Tests for installation token minting + caching.
//
// We don't have a real RSA private key in the test bindings, so we
// generate one per-suite via WebCrypto, export it as PKCS#8 PEM, and
// hand the same key to the helper. The helper signs a JWT and exchanges
// it via a mocked fetcher; we assert the JWT structure GitHub expects
// and the cache reuse behavior.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearInstallationTokenCacheForTesting,
  generateAppJwt,
  getInstallationToken,
} from "../src/github/installation-token.js";

let pem: string;

async function generateTestPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const b64 = Buffer.from(pkcs8).toString("base64");
  const wrapped = b64.match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  pem = await generateTestPem();
});

beforeEach(() => {
  __clearInstallationTokenCacheForTesting();
});

describe("generateAppJwt", () => {
  it("produces a header.payload.signature structure with RS256/JWT", async () => {
    const jwt = await generateAppJwt({ appId: "12345", privateKeyPem: pem });
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
  });

  it("backdates iat by 60s for clock-skew and sets exp 10min out", async () => {
    const now = Date.now();
    const jwt = await generateAppJwt({ appId: "777", privateKeyPem: pem }, now);
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as {
      iat: number;
      exp: number;
      iss: string;
    };
    const seconds = Math.floor(now / 1000);
    expect(payload.iat).toBe(seconds - 60);
    expect(payload.exp).toBe(seconds + 600);
    expect(payload.iss).toBe("777");
  });

  it("rejects PKCS#1 PEMs with a helpful error", async () => {
    const pkcs1 =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBA...\n-----END RSA PRIVATE KEY-----\n";
    await expect(generateAppJwt({ appId: "1", privateKeyPem: pkcs1 })).rejects.toThrow(/PKCS#8/);
  });
});

describe("getInstallationToken", () => {
  function mockFetcher(token: string, expiresAt: string): typeof fetch {
    return vi.fn(
      async () =>
        new Response(JSON.stringify({ token, expires_at: expiresAt }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;
  }

  it("requires GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY", async () => {
    await expect(getInstallationToken({}, 1)).rejects.toThrow(/GITHUB_APP_ID/);
  });

  it("mints a new token via the access-tokens exchange", async () => {
    const fetcher = mockFetcher("ghs-1", new Date(Date.now() + 3_600_000).toISOString());
    const token = await getInstallationToken(
      { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: pem },
      999,
      { fetcher },
    );
    expect(token).toBe("ghs-1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached token while it's well within validity", async () => {
    const fetcher = mockFetcher("ghs-2", new Date(Date.now() + 3_600_000).toISOString());
    await getInstallationToken({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: pem }, 1, { fetcher });
    await getInstallationToken({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: pem }, 1, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-mints when the cached token is within the reuse buffer", async () => {
    // expires in 4min — under the 5-min reuse buffer, so should re-mint.
    const fetcher = mockFetcher("ghs-3", new Date(Date.now() + 4 * 60 * 1000).toISOString());
    await getInstallationToken({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: pem }, 2, { fetcher });
    await getInstallationToken({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: pem }, 2, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("bypassCache forces a re-mint", async () => {
    const fetcher = mockFetcher("ghs-4", new Date(Date.now() + 3_600_000).toISOString());
    await getInstallationToken({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: pem }, 3, { fetcher });
    await getInstallationToken({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: pem }, 3, {
      fetcher,
      bypassCache: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-2xx response from the access-tokens endpoint", async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    await expect(
      getInstallationToken({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: pem }, 4, { fetcher }),
    ).rejects.toThrow(/401/);
  });
});
