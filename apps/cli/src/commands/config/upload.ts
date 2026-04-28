/**
 * config upload command
 */

import { output } from "../../utils/output.js";
import { readFile } from "node:fs/promises";
import { apiRequest } from "../../utils/api.js";

interface UploadConfigOptions {
  configId: string;
  file: string;
}

export async function uploadConfig(opts: UploadConfigOptions): Promise<void> {
  let yaml: string;
  try {
    yaml = await readFile(opts.file, "utf-8");
  } catch (err) {
    output.error(
      `Failed to read file ${opts.file}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const resp = await apiRequest(
    `/api/v1/configurations/${encodeURIComponent(opts.configId)}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: yaml,
    },
  );

  if (resp.error) {
    output.error(`Failed to upload config: ${resp.error}`);
    process.exit(1);
  }

  output.success("Config uploaded");
  output.printJson(resp.data);
}
