// Dead-letter queue consumer for audit events.
//
// Anything that lands here failed `max_retries` times against D1. We log
// to console.error so the event is visible in Workers Logs / OTel and an
// operator can investigate. The DLQ messages are still ack'd — re-queuing
// would just replay the same failure. To replay manually, copy the event
// payloads from logs and re-publish via `wrangler queues consumer`.
//
// See DEVELOPING.md → Audit log for the runbook.

import type { AuditEvent } from "@o11yfleet/core/audit";
import type { Env } from "../index.js";

export async function consumeAuditDlq(batch: MessageBatch<AuditEvent>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const event = msg.body;
    console.error(
      "[audit-dlq] event dropped after retries",
      JSON.stringify({
        id: event.id,
        scope: event.scope,
        action: event.action,
        resource_type: event.resource_type,
        resource_id: event.resource_id,
        created_at: event.created_at,
      }),
    );
    // Counter so alerting can fire on sustained DLQ depth without
    // log scraping. Same shape as the producer-drop counter; queries
    // can join on `audit.dlq` blob to track end-to-end loss.
    if (env.FP_ANALYTICS) {
      try {
        env.FP_ANALYTICS.writeDataPoint({
          indexes: ["audit"],
          blobs: ["audit", "dlq", event.action, event.scope.kind],
          doubles: [1],
        });
      } catch {
        /* best-effort */
      }
    }
    msg.ack();
  }
}
