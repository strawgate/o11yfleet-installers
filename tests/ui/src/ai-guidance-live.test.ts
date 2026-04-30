import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  aiGuidanceRequestSchema,
  aiGuidanceResponseSchema,
  evaluateGuidanceItemQuality,
  type AiGuidanceResponse,
} from "@o11yfleet/core/ai";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const API_URL = process.env.FP_URL ?? "http://127.0.0.1:8787";
const UI_URL = process.env.UI_URL ?? "http://127.0.0.1:3000";
const RESPONSE_TIMEOUT_MS = Number(process.env.AI_GUIDANCE_AUDIT_RESPONSE_TIMEOUT_MS ?? "35000");
const RENDER_SETTLE_MS = Number(process.env.AI_GUIDANCE_AUDIT_RENDER_SETTLE_MS ?? "750");

type GuidanceEndpoint = "/api/v1/ai/guidance" | "/api/admin/ai/guidance";
type UserRole = "portal" | "admin";

type PageContract = {
  id: string;
  role: UserRole;
  path: string;
  heading: string | RegExp;
  endpoint?: GuidanceEndpoint;
  expectedSurface?: string;
  requiresGuidanceRequest?: boolean;
  notes: string;
};

type GuidanceResponse = AiGuidanceResponse;

type GuidanceExchange = {
  ok: boolean;
  status: number;
  url: string;
  request: unknown;
  response: unknown;
};

type RenderedGuidance = {
  slots: string[];
  panels: string[];
  unavailable: string[];
};

type AuditResult = {
  id: string;
  role: UserRole;
  path: string;
  notes: string;
  status: "no_request" | "captured";
  screenshot: string;
  rendered: RenderedGuidance;
  exchange?: GuidanceExchange;
  pageError?: string;
  hardGateFailures: string[];
};

const PAGE_CONTRACTS: PageContract[] = [
  {
    id: "portal-overview",
    role: "portal",
    path: "/portal/overview",
    heading: "Fleet overview",
    endpoint: "/api/v1/ai/guidance",
    expectedSurface: "portal.overview",
    requiresGuidanceRequest: true,
    notes: "Fleet overview may show slotted collector/configuration guidance or silence.",
  },
  {
    id: "portal-configurations",
    role: "portal",
    path: "/portal/configurations",
    heading: "Configurations",
    notes:
      "Configuration list should stay quiet unless a future page-level contract adds guidance.",
  },
  {
    id: "portal-agents",
    role: "portal",
    path: "/portal/agents",
    heading: "Collectors",
    endpoint: "/api/v1/ai/guidance",
    expectedSurface: "portal.agents",
    notes:
      "Agent sections may skip the provider entirely when local data is below materiality gates.",
  },
  {
    id: "admin-overview",
    role: "admin",
    path: "/admin/overview",
    heading: "Admin Overview",
    endpoint: "/api/admin/ai/guidance",
    expectedSurface: "admin.overview",
    requiresGuidanceRequest: true,
    notes: "Admin overview guidance must be aggregate and never raw tenant/user data.",
  },
  {
    id: "admin-usage",
    role: "admin",
    path: "/admin/usage",
    heading: "Usage & Spend",
    endpoint: "/api/admin/ai/guidance",
    expectedSurface: "admin.usage",
    requiresGuidanceRequest: true,
    notes:
      "Usage guidance may call out source coverage or spend caveats without claiming billing truth.",
  },
];

test.describe("live AI guidance audit", () => {
  test.describe.configure({ retries: 0 });

  test.skip(
    process.env.LIVE_AI_GUIDANCE !== "1",
    "Set LIVE_AI_GUIDANCE=1 and provide AI_GUIDANCE_MINIMAX_API_KEY to run the live provider check.",
  );

  test("captures real-provider guidance artifacts and enforces objective hard gates", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);

    const outputRoot = await prepareOutputRoot(testInfo);
    const results: AuditResult[] = [];
    let currentRole: UserRole | null = null;

    for (const contract of PAGE_CONTRACTS) {
      if (currentRole !== contract.role) {
        await loginForRole(page, contract.role);
        currentRole = contract.role;
      }
      results.push(await auditPage(page, contract, outputRoot));
    }

    await writeAuditReport(outputRoot, results);

    const failures = results.flatMap((result) =>
      result.hardGateFailures.map((failure) => `${result.id}: ${failure}`),
    );
    expect(failures, `AI guidance hard-gate failures:\n${failures.join("\n")}`).toEqual([]);
  });
});

async function loginForRole(page: Page, role: UserRole) {
  await page.context().clearCookies();
  if (role === "portal") {
    await login(page, "/login", "demo@o11yfleet.com", "demo-password", "Sign in");
    return;
  }
  await login(
    page,
    "/admin/login",
    "admin@o11yfleet.com",
    "admin-password",
    "Sign in to admin console",
  );
}

async function login(
  page: Page,
  pathName: string,
  email: string,
  password: string,
  button: string,
) {
  await page.goto(withApi(pathName));
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

async function auditPage(
  page: Page,
  contract: PageContract,
  outputRoot: string,
): Promise<AuditResult> {
  const responsePromise = contract.endpoint
    ? waitForGuidanceExchange(page, contract.endpoint)
    : Promise.resolve<null>(null);

  let pageError: string | undefined;
  try {
    await page.goto(withApi(contract.path));
    await expect(page.getByRole("heading", headingOptions(contract.heading))).toBeVisible();
  } catch (error) {
    pageError = errorMessage(error);
  }

  const exchange = pageError
    ? await Promise.race([responsePromise, delay(1_000).then(() => null)])
    : await responsePromise;
  await page.waitForTimeout(RENDER_SETTLE_MS);

  const rendered = await safeCaptureRenderedGuidance(page);
  const screenshotName = `${contract.id}.png`;
  const screenshot = await captureScreenshot(page, path.join(outputRoot, screenshotName));
  const hardGateFailures = evaluateHardGates(contract, exchange, rendered);
  if (!screenshot) {
    hardGateFailures.unshift("failed to capture page screenshot");
  }
  if (pageError) {
    hardGateFailures.unshift(`page did not render expected heading: ${pageError}`);
  }

  const result: AuditResult = {
    id: contract.id,
    role: contract.role,
    path: contract.path,
    notes: contract.notes,
    status: exchange ? "captured" : "no_request",
    screenshot,
    rendered,
    exchange: exchange ?? undefined,
    pageError,
    hardGateFailures,
  };

  await writeJson(path.join(outputRoot, `${contract.id}.json`), result);
  return result;
}

async function waitForGuidanceExchange(
  page: Page,
  endpoint: GuidanceEndpoint,
): Promise<GuidanceExchange | null> {
  try {
    const response = await page.waitForResponse(
      (candidate) =>
        candidate.url() === `${API_URL}${endpoint}` && candidate.request().method() === "POST",
      { timeout: RESPONSE_TIMEOUT_MS },
    );
    return {
      ok: response.ok(),
      status: response.status(),
      url: response.url(),
      request: parseJson(response.request().postData() ?? ""),
      response: await parseResponse(response),
    };
  } catch {
    return null;
  }
}

async function captureRenderedGuidance(page: Page): Promise<RenderedGuidance> {
  return {
    slots: await visibleTexts(page, ".ai-slot"),
    panels: await visibleTexts(page, ".ai-panel"),
    unavailable: await visibleTexts(page, "text=/Guidance unavailable/i"),
  };
}

async function safeCaptureRenderedGuidance(page: Page): Promise<RenderedGuidance> {
  try {
    return await captureRenderedGuidance(page);
  } catch {
    return { slots: [], panels: [], unavailable: [] };
  }
}

async function captureScreenshot(page: Page, filePath: string): Promise<string> {
  try {
    await page.screenshot({ path: filePath, fullPage: true });
    return path.basename(filePath);
  } catch {
    return "";
  }
}

async function visibleTexts(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter(Boolean),
  );
}

function evaluateHardGates(
  contract: PageContract,
  exchange: GuidanceExchange | null,
  rendered: RenderedGuidance,
): string[] {
  const failures: string[] = [];
  if (rendered.unavailable.length > 0) {
    failures.push(`rendered unavailable guidance text: ${rendered.unavailable.join(" | ")}`);
  }
  if (contract.requiresGuidanceRequest && !exchange) {
    failures.push(`expected a ${contract.endpoint} request, but none was captured`);
  }
  if (!exchange) return failures;

  if (!exchange.ok) failures.push(`provider route returned HTTP ${exchange.status}`);

  const request = asRecord(exchange.request);
  if (contract.expectedSurface && request["surface"] !== contract.expectedSurface) {
    failures.push(
      `request surface was ${String(request["surface"])}, expected ${contract.expectedSurface}`,
    );
  }
  const parsedRequest = aiGuidanceRequestSchema.safeParse(exchange.request);
  if (!parsedRequest.success) {
    for (const issue of parsedRequest.error.issues) {
      failures.push(`request schema issue at ${formatSchemaPath(issue.path)}: ${issue.message}`);
    }
  }

  const response = asRecord(exchange.response);
  const guidance = parseGuidanceResponse(response, failures);
  if (!guidance) return failures;

  if (!guidance.model || guidance.model.trim() === "")
    failures.push("response did not include a model");
  if (guidance.model === "o11yfleet-guidance-fixture") {
    failures.push("live audit used the deterministic fixture provider");
  }

  const allowedTargets = new Set(
    Array.isArray(request["targets"])
      ? request["targets"]
          .map((target) => asRecord(target)["key"])
          .filter((key): key is string => typeof key === "string")
      : [],
  );
  for (const item of guidance.items) {
    if (!allowedTargets.has(item.target_key)) {
      failures.push(`item targets unknown key ${item.target_key}`);
    }
    if (!item.evidence || item.evidence.length === 0) {
      failures.push(`item "${item.headline}" has no evidence`);
    }
    const actionHref = item.action?.href;
    if (actionHref && (!actionHref.startsWith("/") || actionHref.startsWith("//"))) {
      failures.push(`item "${item.headline}" has non-app action href ${actionHref}`);
    }
    if (parsedRequest.success) {
      const quality = evaluateGuidanceItemQuality(parsedRequest.data, item);
      if (!quality.keep) {
        failures.push(`item "${item.headline}" failed quality gate: ${quality.reason}`);
      }
    }
  }

  return failures;
}

function parseGuidanceResponse(
  response: Record<string, unknown>,
  failures: string[],
): GuidanceResponse | null {
  const parsed = aiGuidanceResponseSchema.safeParse(response);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      failures.push(`response schema issue at ${formatSchemaPath(issue.path)}: ${issue.message}`);
    }
    return null;
  }
  return parsed.data;
}

async function parseResponse(response: {
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}) {
  try {
    return await response.json();
  } catch {
    return { raw: await response.text() };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function formatSchemaPath(pathParts: Array<string | number>): string {
  return pathParts.length > 0 ? pathParts.join(".") : "<root>";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function prepareOutputRoot(testInfo: TestInfo): Promise<string> {
  const outputRoot =
    process.env.AI_GUIDANCE_AUDIT_DIR?.trim() || testInfo.outputPath("ai-guidance-audit");
  await mkdir(outputRoot, { recursive: true });
  return outputRoot;
}

async function writeAuditReport(outputRoot: string, results: AuditResult[]) {
  await writeJson(path.join(outputRoot, "report.json"), {
    generated_at: new Date().toISOString(),
    api_url: API_URL,
    ui_url: UI_URL,
    pages: results,
  });
  await writeFile(path.join(outputRoot, "report.md"), renderMarkdownReport(results));
}

function renderMarkdownReport(results: AuditResult[]): string {
  const lines = [
    "# AI Guidance Live Audit",
    "",
    "This is an audit artifact, not an eval score. The run captures non-deterministic live-provider output and fails only objective hard gates.",
    "",
    "| Page | Status | Items | Rendered slots | Rendered panels | Hard gate failures |",
    "| --- | --- | ---: | ---: | ---: | --- |",
  ];
  for (const result of results) {
    const response = asRecord(result.exchange?.response);
    const items = Array.isArray(response["items"]) ? response["items"].length : 0;
    const failures = result.hardGateFailures.length
      ? result.hardGateFailures.map(markdownTableCell).join("<br>")
      : "none";
    lines.push(
      `| ${markdownTableCell(result.id)} | ${markdownTableCell(result.status)} | ${items} | ${result.rendered.slots.length} | ${result.rendered.panels.length} | ${failures} |`,
    );
  }
  lines.push("");
  lines.push("Screenshots and per-page JSON files are stored beside this report.");
  lines.push("");
  return lines.join("\n");
}

function markdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function withApi(pathName: string): string {
  const url = new URL(pathName, UI_URL);
  url.searchParams.set("api", API_URL);
  return url.toString();
}

function headingOptions(name: string | RegExp): { name: string | RegExp; exact?: boolean } {
  return typeof name === "string" ? { name, exact: true } : { name };
}
