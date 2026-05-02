import type { Unit } from "./types";

/**
 * Unit-aware axis label formatters. Same fns are shared between
 * the chart axis, tooltip, and legend so a value reads identically
 * everywhere on the page.
 */

const NUM = new Intl.NumberFormat();

export function formatValue(value: number | null | undefined, unit?: Unit): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (unit) {
    case "bytes":
      return formatBytes(value);
    case "percent":
      return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
    case "duration":
      return formatDuration(value);
    default:
      return formatCount(value);
  }
}

function formatCount(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return NUM.format(n);
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = bytes;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

/** Duration in seconds → human string. */
function formatDuration(s: number): string {
  const a = Math.abs(s);
  if (a < 1e-3) return `${(s * 1e6).toFixed(0)}μs`;
  if (a < 1) return `${(s * 1e3).toFixed(0)}ms`;
  if (a < 60) return `${s.toFixed(s < 10 ? 2 : 0)}s`;
  if (a < 3600) return `${(s / 60).toFixed(0)}m`;
  if (a < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

/** Time-axis tick formatter that picks a granularity based on visible span. */
export function formatTimeTick(epochSec: number, spanSec: number): string {
  const d = new Date(epochSec * 1000);
  if (spanSec <= 60 * 60) return formatHM(d, true); // 1h: HH:MM:SS
  if (spanSec <= 24 * 60 * 60) return formatHM(d, false); // 1d: HH:MM
  if (spanSec <= 7 * 24 * 60 * 60) return `${formatMD(d)} ${formatHM(d, false)}`;
  if (spanSec <= 60 * 24 * 60 * 60) return formatMD(d);
  return formatYMD(d);
}

function formatHM(d: Date, withSeconds: boolean): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (!withSeconds) return `${hh}:${mm}`;
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatMD(d: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function formatYMD(d: Date): string {
  const yy = String(d.getFullYear()).slice(2);
  return `${formatMD(d)} '${yy}`;
}
