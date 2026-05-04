/** Session id length in bytes (256 bits → 64 hex chars). */
const SESSION_ID_BYTES = 32;

/** Generate a fresh opaque session id. Hex-encoded so it's safe in cookies,
 *  log lines, and audit metadata without further escaping. */
export function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_ID_BYTES));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Default session lifetime — 7 days, used by both portal and admin auth. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
