// Debug utilities for Playwright tests
// Screenshot capture and error tracking

import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SCREENSHOT_DIR = path.join(process.cwd(), "test-results", "debug-screenshots");

function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

export async function debugScreenshot(
  page: Page,
  name: string,
  options?: { fullPage?: boolean },
): Promise<string> {
  ensureScreenshotDir();
  // Use full UUID to prevent file overwrite in parallel/retried tests
  const uniqueId = randomUUID();
  const filename = `${name.replace(/[^a-z0-9]/gi, "-")}-${uniqueId}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);

  await page.screenshot({ path: filepath, fullPage: options?.fullPage ?? false });
  return filepath;
}

export async function savePageHTML(page: Page, name: string): Promise<string> {
  ensureScreenshotDir();
  // Use full UUID to prevent file overwrite in parallel/retried tests
  const uniqueId = randomUUID();
  const html = await page.content();
  const filename = `${name.replace(/[^a-z0-9]/gi, "-")}-${uniqueId}.html`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  fs.writeFileSync(filepath, html);
  return filepath;
}

export interface ConsoleErrorFilter {
  ignoreResourceErrors?: boolean;
}

export function trackConsoleErrors(
  page: Page,
  options?: ConsoleErrorFilter,
): { errors: string[]; cleanup: () => void } {
  const errors: string[] = [];
  const { ignoreResourceErrors = false } = options ?? {};

  const handler = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === "error") {
      const text = msg.text();
      const isResourceError = text.startsWith("Failed to load resource:");
      if (!ignoreResourceErrors || !isResourceError) {
        errors.push(text);
      }
    }
  };

  page.on("console", handler);

  return {
    errors,
    cleanup: () => page.off("console", handler),
  };
}
