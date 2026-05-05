/**
 * Pure UUID generation utilities.
 * No side effects - all inputs and outputs are deterministic.
 */

/**
 * Generate a random hex string of given length.
 */
export function randomHex(length: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % 16];
  }
  return result;
}

/**
 * Generate a UUID v4 string.
 * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
export function generateUuid(): string {
  const h1 = randomHex(8);
  const h2 = randomHex(4);
  const h3 = randomHex(3); // 3 random chars for position 1-3 of group 3
  const h4 = randomHex(3); // 3 random chars for position 1-3 of group 4
  const h5 = randomHex(12);
  // Group 3: '4' + 3 random hex chars
  // Group 4: '8' + 3 random hex chars (variant bits [89ab])
  return `${h1}-${h2}-4${h3}-8${h4}-${h5}`;
}

/**
 * Validate UUID format.
 */
export function isValidUuid(uid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid);
}

/**
 * Alias for isValidUuid - checks if instance UID is a valid UUID.
 */
export function isValidInstanceUid(uid: string): boolean {
  return isValidUuid(uid);
}

/**
 * Check if a string is a legacy 32-char hex UID.
 */
export function isLegacyInstanceUid(uid: string): boolean {
  return /^[0-9a-f]{32}$/i.test(uid);
}

/**
 * Convert legacy 32-char hex UID to proper UUID format.
 */
export function legacyUidToUuid(uid: string): string {
  if (!isLegacyInstanceUid(uid)) {
    return uid;
  }
  // Insert hyphens to create UUID format
  return [
    uid.slice(0, 8),
    uid.slice(8, 12),
    uid.slice(12, 16),
    uid.slice(16, 20),
    uid.slice(20, 32),
  ].join("-");
}
