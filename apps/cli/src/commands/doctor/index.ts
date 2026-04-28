/**
 * doctor command - Diagnose ofleet CLI issues
 */

import { loadAuth, loadConfig } from "../../utils/config.js";
import { getApiUrl } from "../../utils/config.js";
import { VERSION } from "../../utils/version.js";
import { apiRequest } from "../../utils/api.js";
import { output } from "../../utils/output.js";
import { getCommandName } from "../../utils/command-name.js";

interface DoctorResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  details?: string;
}

async function checkConfig(): Promise<DoctorResult> {
  const auth = await loadAuth();
  const config = await loadConfig();

  if (!auth.apiUrl && !config.apiUrl) {
    return {
      name: "Config",
      status: "fail",
      message: "No API URL configured",
      details: "Set O11YFLEET_API_URL env var or login first",
    };
  }

  return {
    name: "Config",
    status: "pass",
    message: `API URL: ${auth.apiUrl || config.apiUrl}`,
  };
}

async function checkAuth(): Promise<DoctorResult> {
  const auth = await loadAuth();

  if (auth.token) {
    return {
      name: "Auth",
      status: "pass",
      message: "Using API token",
    };
  }

  if (auth.sessionCookie) {
    if (auth.tenantId) {
      return {
        name: "Auth",
        status: "pass",
        message: `Logged in (tenant: ${auth.tenantId.slice(0, 8)}...)`,
      };
    }
    return {
      name: "Auth",
      status: "warn",
      message: "Session exists but no tenant ID",
      details: `Try running '${getCommandName()} login' again`,
    };
  }

  return {
    name: "Auth",
    status: "warn",
    message: "Not logged in",
    details: `Run '${getCommandName()} login' or set O11YFLEET_API_KEY env var`,
  };
}

async function checkConnectivity(): Promise<DoctorResult> {
  const apiUrl = await getApiUrl();

  try {
    const resp = await fetch(`${apiUrl}/healthz`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (resp.ok) {
      return {
        name: "Connectivity",
        status: "pass",
        message: `API reachable at ${apiUrl}`,
      };
    }

    return {
      name: "Connectivity",
      status: "fail",
      message: `API returned ${resp.status}`,
      details: `${apiUrl}/healthz`,
    };
  } catch (err) {
    return {
      name: "Connectivity",
      status: "fail",
      message: "Cannot reach API",
      details: String(err),
    };
  }
}

async function checkApiAuth(): Promise<DoctorResult> {
  const resp = await apiRequest("/auth/me", {
    signal: AbortSignal.timeout(5000),
  });

  if (resp.error || !resp.data) {
    if (resp.status === 401) {
      return {
        name: "API Auth",
        status: "fail",
        message: "Session expired or invalid",
        details: `Run '${getCommandName()} login' again`,
      };
    }
    if (resp.status === 0) {
      return {
        name: "API Auth",
        status: "fail",
        message: "Cannot reach auth endpoint",
        details: resp.error,
      };
    }
    return {
      name: "API Auth",
      status: "fail",
      message: resp.error || "Authentication failed",
    };
  }

  const data = resp.data as { user?: { userId: string; email: string; tenantId?: string } };
  if (data.user) {
    return {
      name: "API Auth",
      status: "pass",
      message: `Authenticated as ${data.user.email}`,
    };
  }
  return {
    name: "API Auth",
    status: "pass",
    message: "Session valid",
  };
}

function printResult(result: DoctorResult): void {
  const c = output.chalkInstance;
  let icon: string;

  switch (result.status) {
    case "pass":
      icon = c.green("✓");
      break;
    case "fail":
      icon = c.red("✗");
      break;
    case "warn":
      icon = c.yellow("!");
      break;
  }

  output.printLine(`  ${icon} ${c.bold(result.name)}: ${result.message}`);
  if (result.details) {
    output.printLine(`    ${c.gray(result.details)}`);
  }
}

export async function doctor(): Promise<void> {
  const c = output.chalkInstance;

  output.printLine(c.bold(`\n${getCommandName()} CLI Doctor`));
  output.printLine(c.gray("─".repeat(40)));
  output.printLine(`Version: ${VERSION}`);
  output.printLine(`Node: ${process.version}`);
  output.printLine(`Platform: ${process.platform} ${process.arch}`);
  output.blank();

  output.printLine("Checking...");

  const checks = [checkConfig(), checkAuth(), checkConnectivity(), checkApiAuth()];

  const results = await Promise.all(checks);

  for (const result of results) {
    printResult(result);
  }

  const failures = results.filter((r) => r.status === "fail");
  const warnings = results.filter((r) => r.status === "warn");

  output.blank();
  if (failures.length > 0) {
    output.printLine(c.red(`\n${failures.length} issue(s) found`));
    output.printLine(c.gray(`Run '${getCommandName()} --help' for usage information`));
    process.exit(1);
  } else if (warnings.length > 0) {
    output.printLine(c.yellow(`\n${warnings.length} warning(s)`));
    output.printLine(c.gray("CLI should work, but some features may be limited"));
    process.exit(0);
  } else {
    output.printLine(c.green("\nAll checks passed!"));
    process.exit(0);
  }
}
