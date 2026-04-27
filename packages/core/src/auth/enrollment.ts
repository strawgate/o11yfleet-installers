// Enrollment tokens
// Format: fp_enroll_{base64url_random_32_bytes}
// Only SHA-256 hash is stored

const encoder = new TextEncoder();

export function generateEnrollmentToken(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const b64 = base64urlEncode(randomBytes);
  return `fp_enroll_${b64}`;
}

export async function hashEnrollmentToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return base64urlEncode(new Uint8Array(hash));
}

export async function verifyEnrollmentToken(
  rawToken: string,
  storedHash: string,
): Promise<boolean> {
  const computedHash = await hashEnrollmentToken(rawToken);
  return computedHash === storedHash;
}

function base64urlEncode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
