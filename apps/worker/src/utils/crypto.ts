// Re-exported from core so the worker can use it without a core dependency cycle.
// The core auth package has no worker dependencies.
export { timingSafeEqual } from "@o11yfleet/core/auth";
