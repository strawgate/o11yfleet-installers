/**
 * Public surface of the chart spine. Pages import from this barrel; nothing
 * else (component palettes, page shells, etc.) should reach into individual
 * files.
 */

export { ChartShell, type ChartShellProps } from "./ChartShell";
export { TimeSeriesChart, type TimeSeriesChartProps } from "./TimeSeriesChart";
export { TimeRangePicker, type TimeRangePickerProps } from "./TimeRangePicker";

export { selectResolution, resolutionToSeconds, bucketCount, rangeMs } from "./selectResolution";
export { resolveTimeRange, RELATIVE_PRESETS, presetLabel, presetSpan } from "./resolveTimeRange";

export { formatValue, formatTimeTick } from "./format";
export { toAlignedData } from "./toAlignedData";

export type {
  Marker,
  ObservationStatus,
  RelativePreset,
  Resolution,
  Series,
  TimeRange,
  TimeRangeSpec,
  Unit,
} from "./types";
