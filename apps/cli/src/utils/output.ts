/**
 * Unified output manager
 * Based on Vercel CLI's Output class pattern
 */

import chalk, { Chalk } from "chalk";
import { terminal, type TerminalCapabilities } from "./terminal.js";

export type LogColor = "default" | "gray" | "cyan" | "green" | "yellow" | "red";

export class Output {
  private stream: typeof process.stdout;
  private errStream: typeof process.stderr;
  private caps: TerminalCapabilities;
  private _jsonMode: boolean = false;
  private chalk: typeof chalk;
  private colorMap: Record<LogColor, typeof chalk>;

  constructor(
    stream: typeof process.stdout = process.stdout,
    errStream: typeof process.stderr = process.stderr,
    caps?: TerminalCapabilities,
  ) {
    this.stream = stream;
    this.errStream = errStream;
    this.caps = caps ?? terminal;
    this.chalk = this.caps.colorEnabled ? chalk : new Chalk({ level: 0 });
    this.colorMap = {
      default: this.chalk,
      gray: this.chalk.gray,
      cyan: this.chalk.cyan,
      green: this.chalk.green,
      yellow: this.chalk.yellow,
      red: this.chalk.red,
    };
  }

  get jsonMode(): boolean {
    return this._jsonMode;
  }

  setJsonMode(enabled: boolean): void {
    this._jsonMode = enabled;
  }

  private print(msg: string): void {
    this.stream.write(msg);
  }

  private printErr(msg: string): void {
    this.errStream.write(msg);
  }

  private formatLink(text: string, url: string): string {
    if (this.caps.supportsHyperlink) {
      return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
    }
    return `${text} (${url})`;
  }

  link(text: string, url: string): string {
    return this.formatLink(text, url);
  }

  log(msg: string, color: LogColor = "default"): void {
    if (this.jsonMode) return;
    const c = this.colorMap[color];
    this.print(`${c(">")} ${msg}\n`);
  }

  success(msg: string): void {
    if (this.jsonMode) return;
    this.print(`${this.chalk.green("✓")} ${msg}\n`);
  }

  error(msg: string, details?: string): void {
    if (this.jsonMode) {
      this.errStream.write(JSON.stringify({ error: msg, details }) + "\n");
      return;
    }
    this.errStream.write(`${this.chalk.red("Error:")} ${msg}\n`);
    if (details) {
      this.errStream.write(`  ${this.chalk.gray(details)}\n`);
    }
  }

  warn(msg: string): void {
    if (this.jsonMode) return;
    this.print(`${this.chalk.yellow("Warning:")} ${msg}\n`);
  }

  info(msg: string): void {
    if (this.jsonMode) return;
    this.print(`${this.chalk.cyan("i")} ${msg}\n`);
  }

  printJson(data: unknown, message?: string): void {
    if (message) {
      this.print(`${this.chalk.gray(">")} ${message}\n`);
    }
    this.print(JSON.stringify(data, null, 2) + "\n");
  }

  exitJson(data: unknown): never {
    this.stream.write(JSON.stringify(data, null, 2) + "\n");
    process.exit(0);
  }

  printLine(msg: string): void {
    this.stream.write(msg + "\n");
  }

  blank(): void {
    this.stream.write("\n");
  }

  get chalkInstance(): typeof chalk {
    return this.chalk;
  }
}

export const output = new Output();
