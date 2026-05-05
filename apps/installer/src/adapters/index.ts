/**
 * Adapters module - implementations of core interfaces with side effects.
 * These connect the pure core logic to actual system operations.
 */

export { NodeFileSystem, nodeFs } from "./fs.js";
export { NodeProcessRunner, nodeProcess } from "./process.js";
export { NodeHttpClient, nodeHttp } from "./http.js";
export { ConsoleLogger, consoleLogger, createLogger } from "./logger.js";
