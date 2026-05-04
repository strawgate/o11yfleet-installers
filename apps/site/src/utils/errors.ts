import { ApiError } from "../api/api-error";

/**
 * Extract a user-facing message from an unknown error value.
 * Prefers ApiError.detail when present (server-supplied human text),
 * then ApiError.message / Error.message, then a generic fallback.
 *
 * Usage:
 *   try { await mutation.mutateAsync(); }
 *   catch (err) {
 *     notifications.show({ message: getErrorMessage(err), color: "red" });
 *   }
 *
 * Replaces the repeated `err instanceof Error ? err.message : "Unknown error"`
 * pattern that ignored ApiError.detail (#785).
 */
export function getErrorMessage(err: unknown, fallback = "Unknown error"): string {
  if (err instanceof ApiError) {
    return err.detail ?? err.message ?? fallback;
  }
  if (err instanceof Error) {
    return err.message || fallback;
  }
  if (typeof err === "string" && err.length > 0) {
    return err;
  }
  return fallback;
}
