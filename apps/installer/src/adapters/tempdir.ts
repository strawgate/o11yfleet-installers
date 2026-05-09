/**
 * Temp directory factory adapter using Node.js fs.
 * Implements the TempDirFactory interface from core/types.ts.
 */

import type { FileSystem, TempDirFactory } from "../core/types.js";

export class NodeTempDirFactory implements TempDirFactory {
  constructor(private fs: FileSystem) {}

  async create(): Promise<string> {
    const tmpDir = "/tmp/o11y-install-" + Math.random().toString(36).slice(2);
    await this.fs.mkdir(tmpDir, true);
    return tmpDir;
  }
}

export function createNodeTempDirFactory(fs: FileSystem): TempDirFactory {
  return new NodeTempDirFactory(fs);
}