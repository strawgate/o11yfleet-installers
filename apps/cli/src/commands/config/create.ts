/**
 * config create command - interactive wizard + non-interactive
 */

import inquirer from "inquirer";
import { output } from "../../utils/output.js";
import { apiRequest } from "../../utils/api.js";
import { canPrompt } from "../../utils/terminal.js";

interface CreateConfigOptions {
  name?: string;
  description?: string;
  interactive?: boolean;
}

export async function createConfig(opts: CreateConfigOptions): Promise<void> {
  let name = opts.name;
  let description = opts.description;

  // Interactive mode
  if (!name || opts.interactive) {
    if (!canPrompt()) {
      output.error("Name is required in non-interactive mode");
      output.log("Usage: o11y config:create --name <name>");
      process.exit(1);
    }

    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Config name:",
        default: name,
        validate: (v) => v.length > 0 || "Name is required",
      },
      {
        type: "input",
        name: "description",
        message: "Description (optional):",
        default: description,
      },
    ]);

    name = answers.name;
    description = answers.description;
  }

  if (!name) {
    output.error("Name is required");
    process.exit(1);
  }

  output.log(`Creating configuration "${name}"...`);

  const resp = await apiRequest("/api/v1/configurations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });

  if (resp.error) {
    output.error(`Failed to create config: ${resp.error}`);
    process.exit(1);
  }

  const config = resp.data as { id: string; name: string };
  output.success(`Configuration created: ${config.id}`);
  output.printJson(config);
}
