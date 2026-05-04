// #791 PoC: vitest setup — jest-dom matchers, cleanup after each test,
// + the window.matchMedia polyfill jsdom doesn't ship and Mantine needs.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Mantine reads window.matchMedia for its color-scheme detection.
// Documented gotcha — apply once at suite startup.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(() => {
  cleanup();
});
