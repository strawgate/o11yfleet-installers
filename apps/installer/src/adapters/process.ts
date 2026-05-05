/**
 * Process runner adapter using Node.js child_process.
 * Implements the ProcessRunner interface from core/types.ts.
 */

import { execSync as nodeExecSync, spawn } from "child_process";

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
    try {
      const options = args ? { args } : undefined;
      return nodeExecSync(cmd, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        ...options,
      });
    } catch (error: unknown) {
      if (error instanceof Error && "stderr" in error) {
        throw new Error(`Command failed: ${(error as { stderr: string }).stderr}`);
      }
      throw error;
    }
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
