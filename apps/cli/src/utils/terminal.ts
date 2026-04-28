/**
 * Terminal capability detection
 * Based on patterns from GitHub CLI and Fly.io
 */

export interface TerminalCapabilities {
  isTTY: boolean;
  isCI: boolean;
  colorEnabled: boolean;
  color256: boolean;
  colorTrue: boolean;
  supportsHyperlink: boolean;
  platform: NodeJS.Platform;
}

export function detectTerminal(): TerminalCapabilities {
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const isCI = Boolean(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.TRAVIS ||
    process.env.CIRCLECI,
  );

  // Color detection
  const clicolorForce = process.env.CLICOLOR_FORCE;
  const noColor = process.env.NO_COLOR;
  const clicolor = process.env.CLICOLOR;

  let colorEnabled = isTTY;
  if (noColor === "1" || clicolor === "0") colorEnabled = false;
  if (clicolorForce === "1") colorEnabled = true;

  const colorterm = process.env.COLORTERM || "";
  const color256 = /256|24bit|truecolor/i.test(colorterm);
  const colorTrue = /24bit|truecolor/i.test(colorterm);

  // Hyperlink detection (iTerm, Hyper, WezTerm, Windows Terminal, Konsole)
  const termProgram = process.env.TERM_PROGRAM || "";
  const wtSession = process.env.WT_SESSION || "";
  const konsole = process.env.KONSOLE_VERSION || "";
  const forceHyperlink = process.env.FORCE_HYPERLINK === "1";

  const supportsHyperlink =
    forceHyperlink ||
    /\b(iTerm\.app|Hyper|WezTerm|WindowsTerminal)\b/i.test(termProgram) ||
    Boolean(wtSession) ||
    Boolean(konsole);

  return {
    isTTY,
    isCI,
    colorEnabled: colorEnabled && !isCI,
    color256: colorEnabled && color256,
    colorTrue: colorEnabled && colorTrue,
    supportsHyperlink: colorEnabled && supportsHyperlink,
    platform: process.platform,
  };
}

export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export function canPrompt(): boolean {
  if (process.env.NO_INTERACTION === "1") return false;
  if (process.env.CI) return false;
  return isInteractive();
}

export const terminal = detectTerminal();
