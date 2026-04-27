// Auth — signed assignment claims
// HMAC-SHA256 via Web Crypto. Base64url JSON `.` signature format.

export interface AssignmentClaim {
  v: 1;
  tenant_id: string;
  config_id: string;
  instance_uid: string;
  generation: number;
  iat: number;
  exp: number;
}

const encoder = new TextEncoder();

function base64urlEncode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signClaim(claim: AssignmentClaim, secret: string): Promise<string> {
  const payload = base64urlEncode(encoder.encode(JSON.stringify(claim)));
  const key = await getSigningKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const sigB64 = base64urlEncode(new Uint8Array(sig));
  return `${payload}.${sigB64}`;
}

export async function verifyClaim(token: string, secret: string): Promise<AssignmentClaim> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("Invalid claim format");
  }
  const [payload, signature] = parts;
  const key = await getSigningKey(secret);
  const sigBytes = base64urlDecode(signature);
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(payload));
  if (!valid) {
    throw new Error("Invalid signature");
  }

  const claim = JSON.parse(new TextDecoder().decode(base64urlDecode(payload))) as AssignmentClaim;

  if (claim.v !== 1) {
    throw new Error(`Unsupported claim version: ${claim.v}`);
  }

  if (claim.exp < Date.now() / 1000) {
    throw new Error("Claim expired");
  }

  return claim;
}
