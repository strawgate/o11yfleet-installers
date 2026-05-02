import type { Series, TimeRange } from "../types";

/**
 * Deterministic synthetic time-series generators. Used by SpinePlayground
 * and the chart density test matrix.
 */

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type GeneratorOpts = {
  range: TimeRange;
  count: number;
  seed?: number;
  /** Floor / ceiling. */
  min?: number;
  max?: number;
  /** When set, every Nth point is `null` (gap). */
  gapEvery?: number;
};

/** Smooth random walk with optional gaps. */
export function generateSeries(name: string, opts: GeneratorOpts, color?: string): Series {
  const { range, count, min = 0, max = 100, seed = 1, gapEvery } = opts;
  const data: Array<[number, number | null]> = [];
  if (count <= 0) return { name, data, color };
  const rand = mulberry32(seed);
  const step = count > 1 ? (range.to - range.from) / (count - 1) : 0;
  let v = (min + max) / 2;
  for (let i = 0; i < count; i++) {
    const ts = Math.round(range.from + step * i);
    const drift = (rand() - 0.5) * (max - min) * 0.08;
    v = Math.max(min, Math.min(max, v + drift));
    if (gapEvery && i > 0 && i % gapEvery === 0) {
      data.push([ts, null]);
    } else {
      data.push([ts, Math.round(v * 100) / 100]);
    }
  }
  return { name, data, color };
}

/** Multi-series generator for stacked / multi-line charts. */
export function generateSeriesGroup(opts: {
  range: TimeRange;
  count: number;
  series: Array<{ name: string; min?: number; max?: number; color?: string }>;
  seedBase?: number;
  gapEvery?: number;
}): Series[] {
  const { range, count, series, seedBase = 1, gapEvery } = opts;
  return series.map((s, i) =>
    generateSeries(
      s.name,
      {
        range,
        count,
        seed: seedBase + i * 31,
        min: s.min,
        max: s.max,
        gapEvery,
      },
      s.color,
    ),
  );
}

export const DENSITY_CASES = [
  { label: "0 points (empty)", count: 0 },
  { label: "1 point", count: 1 },
  { label: "4 points (sparse)", count: 4 },
  { label: "100 points", count: 100 },
  { label: "10k points", count: 10_000 },
  { label: "100k points", count: 100_000 },
  { label: "1k with gaps", count: 1_000, gapEvery: 50 },
] as const;
