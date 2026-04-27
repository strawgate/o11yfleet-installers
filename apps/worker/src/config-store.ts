// R2 Content-Addressed Config Storage
// SHA-256 → R2 key `configs/sha256/{hash}.yaml`
// D1 upsert for config versions

import { parse as parseYaml } from "yaml";

export interface ConfigStoreEnv {
  FP_CONFIGS: R2Bucket;
  FP_DB: D1Database;
}

export interface UploadResult {
  hash: string;
  r2Key: string;
  sizeBytes: number;
  deduplicated: boolean;
}

/**
 * Validate that the input is parseable YAML. Returns null if valid,
 * or an error message string if invalid.
 */
export function validateYaml(content: string): string | null {
  try {
    const parsed = parseYaml(content);
    // Must parse to an object (not a scalar string/number/null)
    if (parsed === null || parsed === undefined || typeof parsed !== "object") {
      return "YAML must parse to a mapping (object), not a scalar value";
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid YAML";
  }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadConfigVersion(
  env: ConfigStoreEnv,
  tenantId: string,
  configId: string,
  yaml: string,
  createdBy?: string,
): Promise<UploadResult> {
  const encoder = new TextEncoder();
  const yamlBytes = encoder.encode(yaml);
  const hash = await sha256Hex(yamlBytes);
  const r2Key = `configs/sha256/${hash}.yaml`;

  // Check for dedup — if R2 object already exists, skip upload
  const existing = await env.FP_CONFIGS.head(r2Key);
  const deduplicated = existing !== null;

  if (!deduplicated) {
    await env.FP_CONFIGS.put(r2Key, yamlBytes, {
      httpMetadata: { contentType: "text/yaml" },
      customMetadata: {
        tenant_id: tenantId,
        config_id: configId,
      },
    });
  }

  // Generate a version ID
  const versionId = crypto.randomUUID();

  // Insert config version record
  await env.FP_DB.prepare(
    `INSERT INTO config_versions (id, config_id, tenant_id, config_hash, r2_key, size_bytes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(config_id, config_hash) DO NOTHING`,
  )
    .bind(versionId, configId, tenantId, hash, r2Key, yamlBytes.byteLength, createdBy ?? null)
    .run();

  // Update current config hash
  await env.FP_DB.prepare(
    `UPDATE configurations SET current_config_hash = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
  )
    .bind(hash, configId, tenantId)
    .run();

  return {
    hash,
    r2Key,
    sizeBytes: yamlBytes.byteLength,
    deduplicated,
  };
}

export async function getConfigContent(
  env: ConfigStoreEnv,
  hash: string,
): Promise<string | null> {
  const r2Key = `configs/sha256/${hash}.yaml`;
  const obj = await env.FP_CONFIGS.get(r2Key);
  if (!obj) return null;
  return obj.text();
}
