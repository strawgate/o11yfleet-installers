/**
 * Logger adapter using console.
 * Implements the Logger interface from core/types.ts.
 */

// ANSI color codes
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const NC = "\x1b[0m"; // No Color

export class ConsoleLogger {
  private quiet: boolean;
  private json: boolean;

  constructor(options?: { quiet?: boolean; json?: boolean }) {
    this.quiet = options?.quiet ?? false;
    this.json = options?.json ?? false;
  }

  info(msg: string): void {
    if (this.quiet) return;
    if (this.json) {
      console.log(JSON.stringify({ level: "info", message: msg }));
    } else {
      console.log(`${CYAN}▸${NC} ${msg}`);
    }
  }

  ok(msg: string): void {
    if (this.quiet) return;
    if (this.json) {
      console.log(JSON.stringify({ level: "ok", message: msg }));
    } else {
      console.log(`${GREEN}✓${NC} ${msg}`);
    }
  }

  warn(msg: string): void {
    if (this.quiet) return;
    if (this.json) {
      console.log(JSON.stringify({ level: "warn", message: msg }));
    } else {
      console.warn(`${YELLOW}!${NC} ${msg}`);
    }
  }

  error(msg: string): void {
    console.error(`${RED}✗${NC} ${msg}`);
  }

  /**
   * Print a formatted header.
   */
  header(title: string): void {
    if (this.quiet) return;
    console.log("");
    console.log(`  ${CYAN}${title}${NC}`);
    console.log(`  ${"─".repeat(title.length + 2)}`);
    console.log("");
  }

  /**
   * Print a success message and exit.
   */
  success(msg: string): void {
    this.ok(msg);
    console.log("");
  }
}

// Singleton instance
export const consoleLogger = new ConsoleLogger();

// Export factory for creating new loggers
export function createLogger(options?: { quiet?: boolean; json?: boolean }): ConsoleLogger {
  return new ConsoleLogger(options);
}
