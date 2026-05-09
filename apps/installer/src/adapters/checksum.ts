/**
 * Checksum verifier adapter using Node.js crypto.
 * Implements the ChecksumVerifier interface from core/types.ts.
 */

import { createHash } from "crypto";
import { createReadStream } from "fs";
import type { ChecksumVerifier } from "../core/types.js";

export class NodeChecksumVerifier implements ChecksumVerifier {
  async sha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);

      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }
}

export const nodeChecksumVerifier = new NodeChecksumVerifier();