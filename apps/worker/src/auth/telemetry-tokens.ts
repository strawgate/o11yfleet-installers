/**
 * Telemetry ingest tokens.
 *
 * Short-lived HS256 JWTs that authorize OTLP ingest from collectors.
 * Claims are verified server-side — the body is never trusted.
 */

import { z } from "zod";
import { SignJWT, jwtVerify } from "jose";

const telemetryClaimSchema = z.object({
  v: z.literal(1),
  tenant_id: z.string().min(1),
  config_id: z.string().min(1),
  collector_id: z.string().min(1),
  signal: z.enum(["metrics", "logs", "traces"]),
  iat: z.number().int(),
  exp: z.number().int(),
});

export interface TelemetryClaim {
  v: 1;
  tenant_id: string;
  config_id: string;
  collector_id: string;
  signal: "metrics" | "logs" | "traces";
  iat: number;
  exp: number;
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
  if (!secret) {
    throw new Error("Telemetry token secret must not be empty");
  }
  const now = Math.floor(Date.now() / 1000);
  const key = new TextEncoder().encode(secret);
  return new SignJWT({
    v: 1,
    tenant_id: params.tenantId,
    config_id: params.configId,
    collector_id: params.collectorId,
    signal: params.signal ?? "metrics",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(key);
}

/**
 * Verify a telemetry token. Returns the claims if valid, null if not.
 */
export async function verifyTelemetryToken(
  token: string,
  secret: string,
): Promise<TelemetryClaim | null> {
  if (!secret) {
    throw new Error("Telemetry token secret must not be empty");
  }
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    return telemetryClaimSchema.parse(payload);
  } catch {
    return null;
  }
}
