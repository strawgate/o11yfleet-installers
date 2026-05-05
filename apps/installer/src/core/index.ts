/**
 * Core module - pure functions with no side effects.
 * All platform detection, URL building, config generation, and validation
 * happens here, making it easy to test without mocking file system or network.
 */

// Types
export * from "./types.js";

// Pure utilities
export * from "./platform.js";
export * from "./urls.js";
export * from "./config.js";
export * from "./uuid.js";
