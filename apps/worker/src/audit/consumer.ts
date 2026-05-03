// Queue consumer: batch-inserts AuditEvents into D1.
//
// **Vendor integration boundary.** This is the only file that knows
// about the storage backend. The producer side (recorder.ts + every
// `withAudit(...)` call site) builds vendor-agnostic `AuditEvent`s and
// puts them on `env.AUDIT_QUEUE`. To swap the backend (e.g., move
// tenant-scoped events to WorkOS Audit Logs while keeping admin-scope
// rows in D1), only this file changes:
//
//     export async function consumeAuditBatch(batch, env) {
//       for (const msg of batch.messages) {
//         const event = msg.body;
//         if (event.scope.kind === "admin") {
//           // Keep admin-scope local — WorkOS organizations are mandatory
//           // and "platform" actions don't fit a customer org.
//           await insertToD1(env, event);
//         } else {
//           const orgId = await resolveWorkOsOrgId(env, event.scope.tenant_id);
//           await env.WORKOS.auditLogs.createEvent(orgId, toWorkOsShape(event), {
//             idempotencyKey: event.id,
//           });
//         }
//         msg.ack();
//       }
//     }
//
// The Cloudflare Queue retry + DLQ semantics carry over unchanged.
//
// On D1 batch failure today we retry the whole batch via the queue
// runtime (max_retries from wrangler.jsonc). Persistently failing
// batches land in the DLQ, which has its own consumer in
// `dlq-consumer.ts`.

import type { AuditActor, AuditEvent } from "@o11yfleet/core/audit";
import { assertNever } from "@o11yfleet/core/assert-never";
import type { Env } from "../index.js";
import { getDb } from "../db/client.js";
import { compileForBatch, insertAuditLog } from "../db/queries.js";

export async function consumeAuditBatch(batch: MessageBatch<AuditEvent>, env: Env): Promise<void> {
  if (batch.messages.length === 0) return;

  const stmts = batch.messages.map((msg) => buildInsertStatement(env, msg.body));

  try {
    await env.FP_DB.batch(stmts);
    for (const msg of batch.messages) msg.ack();
  } catch (err) {
    console.error("[audit-consumer] batch insert failed:", err, `count=${batch.messages.length}`);
    for (const msg of batch.messages) msg.retry();
  }
}

/** Project the discriminated AuditActor union to nullable D1 columns.
 * Each kind exposes a different field set; the projection lets us keep
 * a single SQL row shape while preserving the kind information through
 * "exactly one of actor_user_id / actor_api_key_id / both null = system". */
interface ActorColumns {
  user_id: string | null;
  api_key_id: string | null;
  email: string | null;
  ip: string | null;
  user_agent: string | null;
  impersonator_user_id: string | null;
}

function projectActor(actor: AuditActor): ActorColumns {
  switch (actor.kind) {
    case "user":
      return {
        user_id: actor.user_id,
        api_key_id: null,
        email: actor.email,
        ip: actor.ip,
        user_agent: actor.user_agent,
        impersonator_user_id: actor.impersonator_user_id,
      };
    case "api_key":
      return {
        user_id: null,
        api_key_id: actor.api_key_id,
        email: null,
        ip: actor.ip,
        user_agent: actor.user_agent,
        impersonator_user_id: null,
      };
    case "system":
      return {
        user_id: null,
        api_key_id: null,
        email: null,
        ip: actor.ip,
        user_agent: actor.user_agent,
        impersonator_user_id: null,
      };
    default:
      // Compile-time check: when AuditActor grows a new kind, this
      // assertion fails until the projection is updated.
      return assertNever(actor);
  }
}

/** Serialize event metadata defensively. The wire type allows arbitrary
 * records, so a future caller could pass a value with circular refs,
 * BigInts, or other non-JSON-safe content. We never want one bad event
 * to fail the whole batch; on serialization error we record a stub
 * instead of dropping the row. */
function safeStringifyMetadata(metadata: Record<string, unknown>): string {
  try {
    return JSON.stringify(metadata);
  } catch (err) {
    console.warn("[audit-consumer] metadata serialization failed:", err);
    return JSON.stringify({ _serialization_error: String(err) });
  }
}

function buildInsertStatement(env: Env, event: AuditEvent): D1PreparedStatement {
  // Map the AuditScope discriminated union to the storage column:
  // admin scope is represented as tenant_id NULL.
  const tenantId = event.scope.kind === "tenant" ? event.scope.tenant_id : null;
  const actor = projectActor(event.actor);
  // ON CONFLICT(id) DO NOTHING (via insertAuditLog) makes inserts
  // idempotent: event.id is generated in the producer (crypto.randomUUID),
  // so a queue retry after a partial batch failure won't trip a PRIMARY
  // KEY violation and spin into the DLQ.
  return compileForBatch(
    insertAuditLog(getDb(env.FP_DB), {
      id: event.id,
      tenant_id: tenantId,
      actor_user_id: actor.user_id,
      actor_api_key_id: actor.api_key_id,
      actor_email: actor.email,
      actor_ip: actor.ip,
      actor_user_agent: actor.user_agent,
      impersonator_user_id: actor.impersonator_user_id,
      action: event.action,
      resource_type: event.resource_type,
      resource_id: event.resource_id,
      status: event.status,
      status_code: event.status_code,
      metadata: event.metadata ? safeStringifyMetadata(event.metadata) : null,
      request_id: event.request_id,
      created_at: event.created_at,
    }),
    env.FP_DB,
  );
}
