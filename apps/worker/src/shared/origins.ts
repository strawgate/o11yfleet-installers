export type DeploymentEnvironment = "production" | "staging" | "dev";

export const PRODUCTION_ORIGINS = [
  "https://app.o11yfleet.com",
  "https://admin.o11yfleet.com",
  "https://o11yfleet.com",
  "https://www.o11yfleet.com",
] as const;

export const STAGING_ORIGINS = [
  "https://staging-app.o11yfleet.com",
  "https://staging-admin.o11yfleet.com",
  "https://staging.o11yfleet.com",
] as const;

export const DEV_ORIGINS = [
  "https://dev-app.o11yfleet.com",
  "https://dev-admin.o11yfleet.com",
  "https://dev.o11yfleet.com",
] as const;

const STATIC_SITE_WORKER_ORIGINS: Record<DeploymentEnvironment, readonly string[]> = {
  production: ["https://o11yfleet-site-worker.o11yfleet.workers.dev"],
  staging: ["https://o11yfleet-site-worker-staging.o11yfleet.workers.dev"],
  dev: ["https://o11yfleet-site-worker-dev.o11yfleet.workers.dev"],
} as const;

const PUBLIC_SITE_ORIGINS: Record<DeploymentEnvironment, readonly string[]> = {
  production: PRODUCTION_ORIGINS,
  staging: STAGING_ORIGINS,
  dev: DEV_ORIGINS,
} as const;

export function deploymentEnvironment(environment?: string | null): DeploymentEnvironment {
  switch (environment) {
    case "dev":
    case "staging":
    case "production":
      return environment;
    default:
      return "production";
  }
}

export function primarySiteOriginForEnvironment(environment?: string | null): string {
  switch (deploymentEnvironment(environment)) {
    case "dev":
      return "http://localhost:4000";
    case "staging":
      return "https://staging.o11yfleet.com";
    case "production":
      return "https://o11yfleet.com";
  }
}

export function publicSiteOriginsForEnvironment(environment?: string | null): readonly string[] {
  return PUBLIC_SITE_ORIGINS[deploymentEnvironment(environment)];
}

export function staticSiteWorkerOriginsForEnvironment(
  environment?: string | null,
): readonly string[] {
  return STATIC_SITE_WORKER_ORIGINS[deploymentEnvironment(environment)];
}

export function siteOriginsForEnvironment(environment?: string | null): readonly string[] {
  return [
    ...publicSiteOriginsForEnvironment(environment),
    ...staticSiteWorkerOriginsForEnvironment(environment),
  ];
}

export function isLocalDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isStaticSiteWorkerOrigin(origin: string, environment?: string | null): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      staticSiteWorkerOriginsForEnvironment(environment).includes(url.origin)
    );
  } catch {
    return false;
  }
}

export function isAllowedCorsOrigin(origin: string, environment?: string | null): boolean {
  const normalizedEnvironment = deploymentEnvironment(environment);
  if (PRODUCTION_ORIGINS.includes(origin as (typeof PRODUCTION_ORIGINS)[number])) return true;
  if (isStaticSiteWorkerOrigin(origin, normalizedEnvironment)) return true;
  if (publicSiteOriginsForEnvironment(normalizedEnvironment).includes(origin)) return true;
  if (normalizedEnvironment !== "production" && isLocalDevOrigin(origin)) return true;
  return false;
}

export function isAllowedSiteOrigin(origin: string, environment?: string | null): boolean {
  try {
    const url = new URL(origin);
    const normalizedEnvironment = deploymentEnvironment(environment);
    if (normalizedEnvironment !== "production" && isLocalDevOrigin(origin)) return true;
    return (
      url.protocol === "https:" &&
      siteOriginsForEnvironment(normalizedEnvironment).includes(url.origin)
    );
  } catch {
    return false;
  }
}
