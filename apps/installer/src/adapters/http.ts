/**
 * HTTP client adapter using Node.js fetch.
 * Implements the HttpClient interface from core/types.ts.
 */

import type { HttpClient, DownloadProgress } from "../core/types.js";

export class NodeHttpClient implements HttpClient {
  async fetch(
    url: string,
    options: RequestInit = {},
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      // Enable streaming for progress tracking
      signal: options.signal,
    });

    if (!response.ok && response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // If no progress callback, return as-is
    if (!onProgress || !response.body) {
      return response;
    }

    // For download progress tracking, we need to read the body
    // and report progress. This is a simplified version.
    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];

    let bytesDownloaded = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      chunks.push(value);
      bytesDownloaded += value.length;

      if (contentLength > 0) {
        onProgress({
          bytesDownloaded,
          totalBytes: contentLength,
          percent: Math.round((bytesDownloaded / contentLength) * 100),
        });
      }
    }

    // Create a new response with the collected body
    const body = new Blob(chunks);
    const headers = new Headers(response.headers);
    const init: ResponseInit = {
      status: response.status,
      statusText: response.statusText,
      headers,
    };

    return new Response(body, init);
  }

  /**
   * Simple download to file with progress.
   */
  async downloadToFile(
    url: string,
    filePath: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    const response = await this.fetch(url, {}, onProgress);
    const blob = await response.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());

    const { writeFileSync, mkdirSync } = await import("fs");
    const { dirname } = await import("path");

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, buffer);
  }
}

// Singleton instance
export const nodeHttp = new NodeHttpClient();
