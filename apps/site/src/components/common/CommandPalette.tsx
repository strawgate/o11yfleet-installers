import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Modal, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { inferAiSurface } from "@/ai/browser-context";
import {
  PageCopilotDrawer,
  pageCopilotActions,
  type PageCopilotPrompt,
} from "@/components/ai/PageCopilotDrawer";

export interface CommandItem {
  id: string;
  label: string;
  href: string;
  section?: string;
  disabled?: boolean;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
  placeholder: string;
}

interface PaletteEntry {
  key: string;
  label: string;
  detail: string;
  group: "AI" | "Navigate";
  searchTerms: string;
  disabled: boolean;
  trailing?: string;
  onSelect: () => void;
}

function matches(entry: PaletteEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return entry.searchTerms.toLowerCase().includes(q) || entry.label.toLowerCase().includes(q);
}

const LISTBOX_ID = "command-palette-listbox";

export function CommandPalette({ open, onClose, items, placeholder }: CommandPaletteProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotPrompt, setCopilotPrompt] = useState<PageCopilotPrompt | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const supportsAi = inferAiSurface(location.pathname) !== null;

  function handleClose() {
    setQuery("");
    setActiveIndex(0);
    onClose();
  }

  function activate(item: CommandItem) {
    if (item.disabled) return;
    void navigate(item.href);
    handleClose();
  }

  function openCopilot(action: (typeof pageCopilotActions)[number]) {
    setCopilotPrompt({
      id: `${action.id}:${Date.now()}`,
      text: action.prompt,
      intent: action.intent,
    });
    setCopilotOpen(true);
    handleClose();
  }

  const entries = useMemo<PaletteEntry[]>(() => {
    const aiEntries: PaletteEntry[] = pageCopilotActions.map((action) => ({
      key: `ai:${action.id}`,
      label: action.label,
      detail: "Opens a streaming page copilot",
      group: "AI",
      searchTerms: `${action.label} ai ${action.prompt}`,
      disabled: !supportsAi,
      trailing: !supportsAi ? "Soon" : undefined,
      onSelect: () => openCopilot(action),
    }));
    const navEntries: PaletteEntry[] = items.map((item) => ({
      key: `nav:${item.id}`,
      label: item.label,
      detail: item.section ?? "",
      group: "Navigate",
      searchTerms: `${item.section ?? ""} ${item.label}`,
      disabled: Boolean(item.disabled),
      trailing: item.disabled ? "Soon" : undefined,
      onSelect: () => activate(item),
    }));
    return [...aiEntries, ...navEntries];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, supportsAi]);

  const filtered = useMemo(
    () => entries.filter((entry) => matches(entry, query)),
    [entries, query],
  );
  // Indices of selectable (non-disabled) items in `filtered`. Arrow keys
  // skip disabled rows so users can't land on a no-op.
  const selectableIndices = useMemo(
    () => filtered.map((entry, index) => (entry.disabled ? -1 : index)).filter((i) => i >= 0),
    [filtered],
  );

  // Reset active index whenever the visible list changes so we don't point
  // off the end after a filter narrows the results.
  useEffect(() => {
    if (selectableIndices.length === 0) {
      setActiveIndex(0);
      return;
    }
    if (!selectableIndices.includes(activeIndex)) {
      setActiveIndex(selectableIndices[0]!);
    }
  }, [selectableIndices, activeIndex]);

  function moveActive(delta: 1 | -1) {
    if (selectableIndices.length === 0) return;
    const currentPos = selectableIndices.indexOf(activeIndex);
    const nextPos =
      currentPos === -1
        ? 0
        : (currentPos + delta + selectableIndices.length) % selectableIndices.length;
    setActiveIndex(selectableIndices[nextPos]!);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = filtered[activeIndex];
      if (target && !target.disabled) target.onSelect();
    }
  }

  const aiVisible = filtered.filter((entry) => entry.group === "AI");
  const navVisible = filtered.filter((entry) => entry.group === "Navigate");

  return (
    <>
      <Modal
        opened={open}
        onClose={handleClose}
        title="Command menu"
        size="lg"
        padding={0}
        styles={{ body: { padding: 0 } }}
      >
        <TextInput
          role="combobox"
          aria-label={placeholder}
          aria-expanded
          aria-controls={LISTBOX_ID}
          aria-activedescendant={filtered[activeIndex]?.key ?? undefined}
          aria-autocomplete="list"
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={handleInputKeyDown}
          variant="unstyled"
          px="md"
          py="sm"
          autoFocus
          styles={{
            input: { fontSize: 15 },
            wrapper: { borderBottom: "1px solid var(--mantine-color-default-border)" },
          }}
        />
        <Stack
          gap={0}
          p="xs"
          mah={400}
          style={{ overflowY: "auto" }}
          role="listbox"
          id={LISTBOX_ID}
        >
          {filtered.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" p="md">
              No commands found.
            </Text>
          ) : (
            <>
              {aiVisible.length > 0 ? (
                <PaletteGroup
                  heading="AI"
                  entries={aiVisible}
                  filtered={filtered}
                  activeIndex={activeIndex}
                  onHover={setActiveIndex}
                />
              ) : null}
              {navVisible.length > 0 ? (
                <PaletteGroup
                  heading="Navigate"
                  entries={navVisible}
                  filtered={filtered}
                  activeIndex={activeIndex}
                  onHover={setActiveIndex}
                />
              ) : null}
            </>
          )}
        </Stack>
      </Modal>
      <PageCopilotDrawer
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        initialPrompt={copilotPrompt}
      />
    </>
  );
}

function PaletteGroup({
  heading,
  entries,
  filtered,
  activeIndex,
  onHover,
}: {
  heading: string;
  entries: PaletteEntry[];
  filtered: PaletteEntry[];
  activeIndex: number;
  onHover: (index: number) => void;
}) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} px="sm" pt="xs" pb={4}>
        {heading}
      </Text>
      {entries.map((entry) => {
        const flatIndex = filtered.indexOf(entry);
        const isActive = flatIndex === activeIndex;
        return (
          <UnstyledButton
            key={entry.key}
            id={entry.key}
            role="option"
            aria-selected={isActive}
            aria-disabled={entry.disabled}
            data-active={isActive || undefined}
            disabled={entry.disabled}
            onClick={entry.onSelect}
            onMouseEnter={() => {
              if (!entry.disabled) onHover(flatIndex);
            }}
            px="sm"
            py="xs"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              opacity: entry.disabled ? 0.5 : 1,
              cursor: entry.disabled ? "not-allowed" : "pointer",
              borderRadius: "var(--mantine-radius-sm)",
              background: isActive ? "var(--mantine-color-default-hover)" : undefined,
            }}
          >
            <Stack gap={1} style={{ minWidth: 0, flex: 1 }}>
              <Text size="sm">{entry.label}</Text>
              {entry.detail ? (
                <Text
                  size="xs"
                  c="dimmed"
                  ff={entry.group === "Navigate" ? "monospace" : undefined}
                >
                  {entry.detail}
                </Text>
              ) : null}
            </Stack>
            {entry.trailing ? (
              <Text size="xs" c="dimmed">
                {entry.trailing}
              </Text>
            ) : null}
          </UnstyledButton>
        );
      })}
    </Stack>
  );
}
