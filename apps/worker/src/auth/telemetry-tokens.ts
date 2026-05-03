/**
 * Telemetry ingest tokens.
 *
 * Short-lived HMAC-SHA256 signed JWTs that authorize OTLP ingest from
 * collectors. Claims are verified server-side — the body is never trusted.
 */

import { base64urlEncode, base64urlDecode } from "@o11yfleet/core/auth";

export interface TelemetryClaim {
  v: 1;
  tenant_id: string;
  config_id: string;
  collector_id: string;
  signal: "metrics" | "logs" | "traces";
  iat: number;
  exp: number;
}

const encoder = new TextEncoder();

const keyPromiseCache = new Map<string, Promise<CryptoKey>>();

async function getSigningKey(secret: string): Promise<CryptoKey> {
  let promise = keyPromiseCache.get(secret);
  if (promise) return promise;
  promise = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  keyPromiseCache.set(secret, promise);
  return promise;
}

/**
 * Mint a short-lived telemetry token for a specific collector.
 */
export async function mintTelemetryToken(
  params: {
    tenantId: string;
    configId: string;
    collectorId: string;
    signal?: "metrics" | "logs" | "traces";
  },
  secret: string,
  expiresInSeconds = 15 * 60, // 15 minutes
): Promise<string> {
  const claim: TelemetryClaim = {
    v: 1,
    tenant_id: params.tenantId,
    config_id: params.configId,
    collector_id: params.collectorId,
    signal: params.signal ?? "metrics",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };

  const payload = base64urlEncode(encoder.encode(JSON.stringify(claim)));
  const key = await getSigningKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const sigB64 = base64urlEncode(new Uint8Array(sig));
  return `${payload}.${sigB64}`;
}

/**
 * Verify a telemetry token. Returns the claims if valid, null if not.
 */
export async function verifyTelemetryToken(
  token: string,
  secret: string,
): Promise<TelemetryClaim | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts as [string, string];
  const key = await getSigningKey(secret);

  try {
    const sigBytes = base64urlDecode(signature);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes.buffer.slice(
        sigBytes.byteOffset,
        sigBytes.byteOffset + sigBytes.byteLength,
      ) as ArrayBuffer,
      encoder.encode(payload),
    );
    if (!valid) return null;

    const claim = JSON.parse(new TextDecoder().decode(base64urlDecode(payload))) as TelemetryClaim;

    // Check expiration
    if (claim.exp < Math.floor(Date.now() / 1000)) return null;

    return claim;
  } catch {
    return null;
  }
}
