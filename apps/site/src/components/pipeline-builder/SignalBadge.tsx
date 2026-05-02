import { Badge } from "@mantine/core";
import type { PipelineSignal } from "@o11yfleet/core/pipeline";

const SIGNAL_COLOR: Record<PipelineSignal, string> = {
  logs: "blue",
  metrics: "brand",
  traces: "violet",
};

export function SignalBadge({ signal }: { signal: PipelineSignal }) {
  return (
    <Badge size="xs" variant="light" color={SIGNAL_COLOR[signal]}>
      {signal}
    </Badge>
  );
}

/** Stroke colour for an edge of a given signal. Used by SignalEdge. */
export function signalStroke(signal: PipelineSignal): string {
  return `var(--mantine-color-${SIGNAL_COLOR[signal]}-5)`;
}
