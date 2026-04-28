#!/usr/bin/env node
/**
 * ofleet CLI - Command-line interface for o11yfleet
 *
 * Built with yargs, following patterns from Vercel, Railway, and GitHub CLIs.
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { output } from "./utils/output.js";
import { VERSION } from "./utils/version.js";
import { getCommandName } from "./utils/command-name.js";

// Auth commands
import { login } from "./commands/auth/login.js";
import { logout } from "./commands/auth/logout.js";
import { me } from "./commands/auth/me.js";

// Tenant commands
import { createTenant } from "./commands/tenant/create.js";

// Config commands
import { createConfig } from "./commands/config/create.js";
import { listConfigs } from "./commands/config/list.js";
import { showConfig } from "./commands/config/show.js";
import { uploadConfig } from "./commands/config/upload.js";
import { rolloutConfig } from "./commands/config/rollout.js";

// Token commands
import { createToken } from "./commands/token/create.js";
import { listTokens } from "./commands/token/list.js";

// Agent commands
import { listAgents } from "./commands/agents/list.js";

// Bench commands
import { benchEnrollment } from "./commands/bench/enrollment.js";
import { benchConfigPush } from "./commands/bench/config-push.js";
import { benchProvisioning } from "./commands/bench/provisioning.js";

// Utility commands
import { completion } from "./commands/completion/index.js";
import { doctor } from "./commands/doctor/index.js";

async function main() {
  const commandName = getCommandName();

  await yargs(hideBin(process.argv))
    .scriptName(commandName)
    .usage("$0 <command> [options]")
    .version(VERSION)
    .alias("v", "version")
    .help()
    .alias("h", "help")
    .alias("?", "help")

    // Global options
    .option("api-url", {
      type: "string",
      description: "o11yfleet API URL",
      default: process.env.O11YFLEET_API_URL || "http://localhost:8787",
    })
    .option("json", {
      type: "boolean",
      description: "Output JSON instead of human-readable text",
      default: false,
    })

    // Positional command
    .command(
      "login",
      "Login to o11yfleet",
      (y) =>
        y
          .option("email", { type: "string", description: "Email address" })
          .option("password", { type: "string", description: "Password" })
          .option("token", { type: "string", description: "API token instead of email/password" }),
      async (argv) => {
        if (argv.json) output.setJsonMode(true);
        await login({
          email: argv.email,
          password: argv.password,
          token: argv.token,
        });
      },
    )

    .command("logout", "Logout from o11yfleet", {}, async (argv) => {
      if (argv.json) output.setJsonMode(true);
      await logout();
    })

    .command("me", "Show current user", {}, async (argv) => {
      if (argv.json) output.setJsonMode(true);
      await me();
    })

    // Tenant
    .command(
      "tenant:create",
      "Create a new tenant",
      (y) =>
        y
          .option("name", { type: "string", description: "Tenant name", demandOption: true })
          .option("api-key", { type: "string", description: "Admin API key", demandOption: true }),
      async (argv) => {
        if (argv.json) output.setJsonMode(true);
        await createTenant({ name: argv.name!, apiKey: argv["api-key"]! });
      },
    )

    // Config
    .command(
      "config:create",
      "Create a new configuration",
      (y) =>
        y
          .option("name", { type: "string", description: "Config name" })
          .option("description", { type: "string", description: "Config description" })
          .option("interactive", {
            type: "boolean",
            description: "Interactive mode",
            default: false,
          }),
      async (argv) => {
        if (argv.json) output.setJsonMode(true);
        await createConfig({
          name: argv.name,
          description: argv.description,
          interactive: argv.interactive,
        });
      },
    )

    .command("config:list", "List configurations", {}, async (argv) => {
      if (argv.json) output.setJsonMode(true);
      await listConfigs();
    })

    .command(
      "config:show",
      "Show configuration details",
      (y) =>
        y.option("config-id", { type: "string", description: "Config ID", demandOption: true }),
      async (argv) => {
        if (argv.json) output.setJsonMode(true);
        await showConfig({ configId: argv["config-id"]! });
      },
    )

    .command(
      "config:upload",
      "Upload a config version",
      (y) =>
        y
          .option("config-id", { type: "string", description: "Config ID", demandOption: true })
          .option("file", { type: "string", description: "Config YAML file", demandOption: true }),
      async (argv) => {
        if (argv.json) output.setJsonMode(true);
        await uploadConfig({ configId: argv["config-id"]!, file: argv.file! });
      },
    )

    .command(
      "config:rollout",
      "Rollout config to agents",
      (y) =>
        y.option("config-id", { type: "string", description: "Config ID", demandOption: true }),
      async (argv) => {
        if (argv.json) output.setJsonMode(true);
        await rolloutConfig({ configId: argv["config-id"]! });
      },
    )

    // Alias for config:show
    .command(
      "config",
      "Show configuration details",
      (y) =>
        y.option("config-id", { type: "string", description: "Config ID", demandOption: true }),
      async (argv) => {
        if (argv.json) output.setJsonMode(true);
        await showConfig({ configId: argv["config-id"]! });
      },
    )

    // Tokens
    .command(
      "token:create",
      "Create an enrollment token",
      (y) =>
        y
          .option("config-id", { type: "string", description: "Config ID", demandOption: true })
          .option("label", { type: "string", description: "Token label" })
          .option("expires-in", { type: "string", description: "Expiration in hours" }),
      async (argv) => {
        if (argv.json) output.setJsonMode(true);
        await createToken({
          configId: argv["config-id"]!,
          label: argv.label,
          expiresIn: argv["expires-in"],
        });
      },
    )

    .command(
      "token:list",
      "List enrollment tokens",
      (y) =>
        y.option("config-id", { type: "string", description: "Config ID", demandOption: true }),
      async (argv) => {
        if (argv.json) output.setJsonMode(true);
        await listTokens({ configId: argv["config-id"]! });
      },
    )

    // Agents
    .command(
      "agents:list",
      "List agents",
      (y) =>
        y
          .option("config-id", { type: "string", description: "Config ID", demandOption: true })
          .option("stats", {
            type: "boolean",
            description: "Show aggregate stats",
            default: false,
          }),
      async (argv) => {
        if (argv.json) output.setJsonMode(true);
        await listAgents({ configId: argv["config-id"]!, stats: argv.stats });
      },
    )

    .command(
      "agents",
      "List agents",
      (y) =>
        y
          .option("config-id", { type: "string", description: "Config ID", demandOption: true })
          .option("stats", {
            type: "boolean",
            description: "Show aggregate stats",
            default: false,
          }),
      async (argv) => {
        if (argv.json) output.setJsonMode(true);
        await listAgents({ configId: argv["config-id"]!, stats: argv.stats });
      },
    )

    // Bench
    .command(
      "bench:enrollment",
      "Run enrollment benchmark",
      (y) =>
        y
          .option("config-id", { type: "string", description: "Config ID", demandOption: true })
          .option("collectors", {
            type: "string",
            description: "Number of collectors",
            default: "10",
          }),
      async (argv) => {
        output.setJsonMode(true); // Bench output is always JSON
        await benchEnrollment({
          configId: argv["config-id"]!,
          collectors: parseInt(argv.collectors, 10),
        });
      },
    )

    .command(
      "bench:config-push",
      "Run config push benchmark",
      (y) =>
        y
          .option("config-id", { type: "string", description: "Config ID", demandOption: true })
          .option("file", { type: "string", description: "Config YAML file" }),
      async (argv) => {
        output.setJsonMode(true);
        await benchConfigPush({ configId: argv["config-id"]!, file: argv.file });
      },
    )

    .command(
      "bench:provisioning",
      "Run provisioning benchmark",
      (y) =>
        y
          .option("api-key", { type: "string", description: "Admin API key", demandOption: true })
          .option("name", { type: "string", description: "Tenant name", default: "bench-tenant" }),
      async (argv) => {
        output.setJsonMode(true);
        await benchProvisioning({ apiKey: argv["api-key"]!, name: argv.name });
      },
    )

    // Utility commands
    .command(
      "completion",
      "Generate shell completion scripts",
      (y) =>
        y.option("shell", {
          type: "string",
          description: "Shell type (bash, zsh, fish)",
          default: "bash",
        }),
      async (argv: Record<string, unknown>) => {
        await completion((argv._ as string[]).slice(1));
      },
    )

    .command("doctor", "Diagnose CLI issues", {}, async () => {
      await doctor();
    })

    // Show help if no command
    .demandCommand(1, `Specify a command. Run '${commandName} --help' for available commands.`)

    .epilog(
      `
Examples:
  ${commandName} login --email demo@o11yfleet.com --password secret
  ${commandName} config:list
  ${commandName} config:upload --config-id <id> --file config.yaml
  ${commandName} config:rollout --config-id <id>
  ${commandName} agents:list --config-id <id>
  ${commandName} bench:provisioning --api-key <key>

For more info, see https://github.com/strawgate/o11yfleet`,
    )

    .parse();
}

main().catch((err) => {
  output.error(err.message || String(err));
  process.exit(1);
});
