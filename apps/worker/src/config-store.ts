// R2 Content-Addressed Config Storage
// SHA-256 → R2 key `configs/sha256/{hash}.yaml`
// D1 upsert for config versions

import { parse as parseYaml } from "yaml";

export interface ConfigStoreEnv {
  FP_CONFIGS: R2Bucket;
  FP_DB: D1Database;
}

export interface UploadResult {
  /** D1 row id of the inserted config_versions row. Surfaces back to
   * callers so the audit log can record the published version id (not
   * the configuration id) under config_version.publish. */
  versionId: string;
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

  const candidateVersionId = crypto.randomUUID();

  // Atomically insert version record (skip on conflict) and update
  // current hash. On conflict the UPDATE still runs, so the
  // configuration's current_config_hash is set even when the version
  // row already existed from a prior upload.
  await env.FP_DB.batch([
    env.FP_DB.prepare(
      `INSERT INTO config_versions (id, config_id, tenant_id, config_hash, r2_key, size_bytes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(config_id, config_hash) DO NOTHING`,
    ).bind(
      candidateVersionId,
      configId,
      tenantId,
      hash,
      r2Key,
      yamlBytes.byteLength,
      createdBy ?? null,
    ),
    env.FP_DB.prepare(
      `UPDATE configurations SET current_config_hash = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
    ).bind(hash, configId, tenantId),
  ]);

  // Confirm the canonical id that was actually persisted. `ON CONFLICT
  // DO NOTHING` silently skips the INSERT when a row for this
  // (config_id, config_hash) already exists — either because we
  // re-uploaded identical YAML or because a concurrent caller won the
  // race. The audit log uses this id as `resource_id`, so it must
  // always reference a row that actually lives in `config_versions`.
  const canonical = await env.FP_DB.prepare(
    `SELECT id FROM config_versions WHERE config_id = ? AND config_hash = ?`,
  )
    .bind(configId, hash)
    .first<{ id: string }>();
  if (!canonical) {
    // The row should always exist post-batch — either our INSERT
    // landed it, or a prior call did. Falling back to candidateVersionId
    // would risk handing a phantom id to the audit log; surface the
    // anomaly instead so it lands in the request error path.
    throw new Error(
      `config_versions row not found after upsert (config_id=${configId}, hash=${hash})`,
    );
  }
  const versionId = canonical.id;

  // Note: an earlier version of this function did a second
  // `FP_CONFIGS.put` here in the `deduplicated` branch. That was
  // backwards — `deduplicated=true` means the bytes are already in R2
  // and the upload at line 59 was correctly skipped. Re-PUTting on the
  // dedup path was wasted bandwidth + a needless write op per upload.

  return {
    versionId,
    hash,
    r2Key,
    sizeBytes: yamlBytes.byteLength,
    deduplicated,
  };
}

export async function getConfigContent(env: ConfigStoreEnv, hash: string): Promise<string | null> {
  const r2Key = `configs/sha256/${hash}.yaml`;
  const obj = await env.FP_CONFIGS.get(r2Key);
  if (!obj) return null;
  return obj.text();
}

export async function deleteConfigContentIfUnreferenced(
  env: ConfigStoreEnv,
  r2Key: string,
): Promise<void> {
  const remainingBeforeDelete = await env.FP_DB.prepare(
    `SELECT 1 as found FROM config_versions WHERE r2_key = ? LIMIT 1`,
  )
    .bind(r2Key)
    .first<{ found: number }>();
  if (remainingBeforeDelete) return;

  const object = await env.FP_CONFIGS.get(r2Key);
  const bytes = object ? await object.arrayBuffer() : null;
  const contentType = object?.httpMetadata?.contentType;
  const customMetadata = object?.customMetadata;

  await env.FP_CONFIGS.delete(r2Key);

  const remainingAfterDelete = await env.FP_DB.prepare(
    `SELECT 1 as found FROM config_versions WHERE r2_key = ? LIMIT 1`,
  )
    .bind(r2Key)
    .first<{ found: number }>();
  if (remainingAfterDelete && bytes) {
    await env.FP_CONFIGS.put(r2Key, bytes, {
      httpMetadata: contentType ? { contentType } : undefined,
      customMetadata,
    });
  }
}
