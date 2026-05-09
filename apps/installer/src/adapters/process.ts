/**
 * Process runner adapter using Node.js child_process.
 * Implements the ProcessRunner interface from core/types.ts.
 */

import { spawn, spawnSync } from "child_process";

export class NodeProcessRunner {
  private _uid: number;
  private _gid: number;

  constructor() {
    this._uid = process.getuid?.() ?? 0;
    this._gid = process.getgid?.() ?? 0;
  }

  async exec(cmd: string, args: string[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: "inherit",
        shell: true,
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command exited with code ${code}`));
        }
      });

      child.on("error", reject);
    });
  }

  execSync(cmd: string, args?: string[]): string {
    const result = spawnSync(cmd, args ?? [], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (result.error) {
      throw new Error(`Command failed: ${result.error.message}`);
    }

    if (result.status !== 0) {
      throw new Error(`Command exited with code ${result.status}`);
    }

    return result.stdout ?? "";
  }

  currentUid(): number {
    return this._uid;
  }

  currentGid(): number {
    return this._gid;
  }
}

// Singleton instance
export const nodeProcess = new NodeProcessRunner();
