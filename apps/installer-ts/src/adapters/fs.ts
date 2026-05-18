/**
 * File system adapter using Node.js.
 * Implements the FileSystem interface from core/types.ts.
 */

import { promises as fs } from "fs";

export class NodeFileSystem {
  async readFile(path: string): Promise<string> {
    return fs.readFile(path, "utf-8");
  }

  async writeFile(path: string, contents: string): Promise<void> {
    const { dirname } = await import("path");
    const dir = dirname(path);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path, contents, "utf-8");
  }

  async chmod(path: string, mode: number): Promise<void> {
    await fs.chmod(path, mode);
  }

  async mkdir(path: string, recursive = false): Promise<void> {
    await fs.mkdir(path, { recursive });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async remove(path: string): Promise<void> {
    const stat = await fs.stat(path);
    if (stat.isDirectory()) {
      await fs.rm(path, { recursive: true, force: true });
    } else {
      await fs.unlink(path);
    }
  }

  async listDir(path: string): Promise<string[]> {
    return fs.readdir(path);
  }

  async uid(): Promise<number> {
    return process.getuid?.() ?? 0;
  }

  async gid(): Promise<number> {
    return process.getgid?.() ?? 0;
  }
}

// Singleton instance
export const nodeFs = new NodeFileSystem();
