import type { AnyFleetEvent } from "@o11yfleet/core/events";
import { FleetEventType } from "@o11yfleet/core/events";

type StructuredLogger = Pick<Console, "warn">;

const MAX_LOGGED_ERROR_MESSAGE_LENGTH = 512;
const TRUNCATION_MARKER = " [truncated]";

function sanitizeConfigRejectionMessage(message: string): string {
  let sanitized = message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted-secret]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-ip]")
    .replace(/(?:\/Users|\/home|\/var|\/etc|\/tmp)\/[^\s,;]+/g, "[redacted-path]")
    .replace(/\b[A-Za-z]:\\[^\s,;]+/g, "[redacted-path]")
    .replace(/\\\\[^\s,;]+/g, "[redacted-path]")
    .replace(/\s+/g, " ")
    .trim();

  if (sanitized.length > MAX_LOGGED_ERROR_MESSAGE_LENGTH) {
    sanitized =
      sanitized.slice(0, MAX_LOGGED_ERROR_MESSAGE_LENGTH - TRUNCATION_MARKER.length) +
      TRUNCATION_MARKER;
  }

  return sanitized;
}

export function logTransitionEvents(
  events: AnyFleetEvent[],
  logger: StructuredLogger = console,
): void {
  for (const event of events) {
    if (event.type !== FleetEventType.CONFIG_REJECTED) continue;

    logger.warn({
      event: "config_rejected",
      tenant_id: event.tenant_id,
      config_id: event.config_id,
      instance_uid: event.instance_uid,
      config_hash: event.config_hash,
      error_message: sanitizeConfigRejectionMessage(event.error_message),
    });
  }
}
