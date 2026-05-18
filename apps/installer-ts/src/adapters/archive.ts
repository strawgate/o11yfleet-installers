/**
 * Archive extractor adapter using Node.js child_process.
 * Implements the ArchiveExtractor interface from core/types.ts.
 */

import { execSync } from "child_process";
import type { ArchiveExtractor, OS } from "../core/types.js";

export class NodeArchiveExtractor implements ArchiveExtractor {
  async extract(os: OS, archivePath: string, destDir: string): Promise<void> {
    if (os === "windows") {
      // Windows: use PowerShell Expand-Archive
      execSync(
        `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`,
        { stdio: "pipe" },
      );
    } else {
      // Unix: use tar
      execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: "pipe" });
    }
  }
}

// Singleton instance
export const nodeArchiveExtractor = new NodeArchiveExtractor();
