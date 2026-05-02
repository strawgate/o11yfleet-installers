import { useState } from "react";
import { Button, Group, Popover, SegmentedControl, Stack, Text } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { RELATIVE_PRESETS, presetLabel, resolveTimeRange } from "./resolveTimeRange";
import type { RelativePreset, TimeRangeSpec } from "./types";

export type TimeRangePickerProps = {
  value: TimeRangeSpec;
  onChange: (next: TimeRangeSpec) => void;
};

/**
 * Time range selector that persists `kind` (relative vs absolute) so a
 * "Last 7 days" preset survives page refresh as a relative anchor — not
 * frozen at the resolved timestamps. Mirrors Grafana's behaviour.
 *
 * Composition:
 *  - `<Popover>` containing
 *    - `<SegmentedControl>` over RELATIVE_PRESETS for one-click ranges
 *    - "Custom" tab with two `<DateTimePicker>` for absolute from/to
 */
export function TimeRangePicker({ value, onChange }: TimeRangePickerProps) {
  const [opened, setOpened] = useState(false);
  const [tab, setTab] = useState<"relative" | "absolute">(
    value.kind === "absolute" ? "absolute" : "relative",
  );

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      withinPortal
      shadow="md"
      width={360}
    >
      <Popover.Target>
        <Button variant="default" size="sm" onClick={() => setOpened((o) => !o)}>
          {summarise(value)}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <SegmentedControl
            value={tab}
            onChange={(v) => setTab(v as "relative" | "absolute")}
            data={[
              { label: "Relative", value: "relative" },
              { label: "Custom", value: "absolute" },
            ]}
            fullWidth
          />
          {tab === "relative" ? (
            <RelativeGrid
              value={value.kind === "relative" ? value.preset : "24h"}
              onPick={(preset) => {
                onChange({ kind: "relative", preset });
                setOpened(false);
              }}
            />
          ) : (
            <AbsoluteForm
              value={value}
              onSubmit={(spec) => {
                onChange(spec);
                setOpened(false);
              }}
            />
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function RelativeGrid({
  value,
  onPick,
}: {
  value: RelativePreset;
  onPick: (p: RelativePreset) => void;
}) {
  return (
    <Group gap="xs">
      {RELATIVE_PRESETS.map((p) => (
        <Button
          key={p}
          size="xs"
          variant={value === p ? "filled" : "default"}
          onClick={() => onPick(p)}
        >
          {presetLabel(p)}
        </Button>
      ))}
    </Group>
  );
}

function AbsoluteForm({
  value,
  onSubmit,
}: {
  value: TimeRangeSpec;
  onSubmit: (spec: TimeRangeSpec) => void;
}) {
  // Mantine v9's DateTimePicker uses ISO-like string values, not Date.
  const initialMs =
    value.kind === "absolute"
      ? { from: value.from, to: value.to }
      : (() => {
          const r = resolveTimeRange(value);
          return { from: r.from, to: r.to };
        })();
  const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 19);
  const [from, setFrom] = useState<string | null>(toIso(initialMs.from));
  const [to, setTo] = useState<string | null>(toIso(initialMs.to));

  const fromMs = from ? Date.parse(from) : NaN;
  const toMs = to ? Date.parse(to) : NaN;
  const valid = Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs < toMs;

  return (
    <Stack gap="xs">
      <DateTimePicker
        label="From"
        value={from}
        onChange={setFrom}
        popoverProps={{ withinPortal: true }}
      />
      <DateTimePicker
        label="To"
        value={to}
        onChange={setTo}
        popoverProps={{ withinPortal: true }}
      />
      {!valid && from && to && (
        <Text c="var(--mantine-color-err-5)" size="xs">
          "From" must precede "To".
        </Text>
      )}
      <Button
        disabled={!valid}
        onClick={() => valid && onSubmit({ kind: "absolute", from: fromMs, to: toMs })}
      >
        Apply
      </Button>
    </Stack>
  );
}

function summarise(spec: TimeRangeSpec): string {
  if (spec.kind === "relative") return presetLabel(spec.preset);
  const fmt = (n: number) => new Date(n).toLocaleString();
  return `${fmt(spec.from)} → ${fmt(spec.to)}`;
}
