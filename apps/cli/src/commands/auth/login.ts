/**
 * Login command
 * Supports email/password or API token
 */

import { output } from "../../utils/output.js";
import { loadAuth, saveAuth } from "../../utils/config.js";
import { canPrompt } from "../../utils/terminal.js";
import { getCommandName } from "../../utils/command-name.js";
import inquirer from "inquirer";

interface LoginOptions {
  email?: string;
  password?: string;
  token?: string;
}

interface MeResponse {
  user?: {
    userId: string;
    email: string;
    tenantId?: string;
  };
}

export async function login(opts: LoginOptions): Promise<void> {
  const auth = await loadAuth();

  // Token login (CI/non-interactive)
  if (opts.token) {
    auth.token = opts.token;
    auth.sessionCookie = undefined;
    await saveAuth(auth);
    output.success("Logged in with API token");
    return;
  }

  // Interactive prompt if no credentials provided
  if (!opts.email || !opts.password) {
    if (!canPrompt()) {
      output.error("Email and password required in non-interactive mode");
      output.log(`Or use: ${getCommandName()} login --token <api-token>`);
      process.exit(1);
    }

    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "email",
        message: "Email:",
        default: opts.email,
        validate: (v) => v.includes("@") || "Please enter a valid email",
      },
      {
        type: "password",
        name: "password",
        message: "Password:",
        mask: "*",
      },
    ]);

    opts.email = answers.email;
    opts.password = answers.password;
  }

  // Make login request
  let resp: Response;
  try {
    resp = await fetch(`${auth.apiUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: opts.email, password: opts.password }),
    });
  } catch (err) {
    output.error(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (!resp.ok) {
    const error = await resp.text().catch(() => "Login failed");
    output.error(`Login failed: ${error}`);
    process.exit(1);
  }

  // Extract session cookie
  const setCookie = resp.headers.get("Set-Cookie") || "";
  const sessionMatch = setCookie.match(/fp_session=([^;]+)/);
  const sessionCookie = sessionMatch?.[1];

  if (!sessionCookie) {
    output.error("No session cookie received");
    process.exit(1);
  }

  // Get tenant ID
  let tenantId: string | undefined;
  try {
    const meResp = await fetch(`${auth.apiUrl}/auth/me`, {
      headers: { Cookie: `fp_session=${sessionCookie}` },
    });

    if (meResp.ok) {
      const me = (await meResp.json()) as MeResponse;
      tenantId = me.user?.tenantId;
    }
  } catch {
    // Silently ignore - tenantId will be undefined
  }

  // Save auth
  auth.sessionCookie = sessionCookie;
  auth.token = undefined;
  auth.tenantId = tenantId;
  await saveAuth(auth);

  output.success(`Logged in${tenantId ? ` to tenant ${tenantId}` : ""}`);
}
