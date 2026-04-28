// Hex ↔ Uint8Array conversion utilities

export function hexToUint8Array(hex: string): Uint8Array {
  // Pad odd-length strings with a leading zero for robustness
  const padded = hex.length % 2 !== 0 ? "0" + hex : hex;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < padded.length; i += 2) {
    const byte = parseInt(padded.substring(i, i + 2), 16);
    bytes[i / 2] = isNaN(byte) ? 0 : byte;
  }
  return bytes;
}

export function uint8ToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
