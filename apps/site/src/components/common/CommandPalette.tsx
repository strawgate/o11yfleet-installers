import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Spotlight } from "@mantine/spotlight";
import "@mantine/spotlight/styles.css";
import { Bot, ArrowRight } from "lucide-react";
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

/**
 * Cmd-K palette built on @mantine/spotlight. Spotlight ships keyboard
 * navigation (ArrowUp/Down, Enter, Escape), search filtering, and ARIA
 * combobox/listbox/option semantics out of the box, so this component just
 * shapes the actions list and bridges Spotlight's store with the parent
 * layouts' controlled `open`/`onClose` API.
 *
 * We render with a per-instance store via `createSpotlightStore()` rather
 * than the singleton so the portal and admin layouts can each mount their
 * own palette without colliding.
 */
export function CommandPalette({ open, onClose, items, placeholder }: CommandPaletteProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotPrompt, setCopilotPrompt] = useState<PageCopilotPrompt | null>(null);
  const supportsAi = inferAiSurface(location.pathname) !== null;

  // Use Spotlight's `forceOpened` prop to drive open state from the
  // parent's controlled `open`. This sidesteps Spotlight's internal store
  // and lets the layouts' existing useState/setOpen pattern keep working
  // without a separate store bridge.

  function activate(item: CommandItem) {
    if (item.disabled) return;
    void navigate(item.href);
    onClose();
  }

  function openCopilot(action: (typeof pageCopilotActions)[number]) {
    setCopilotPrompt({
      id: `${action.id}:${Date.now()}`,
      text: action.prompt,
      intent: action.intent,
    });
    setCopilotOpen(true);
    onClose();
  }

  // Build the action groups for Spotlight. AI actions first, then nav
  // entries grouped by their section label (matches the prior layout's
  // intent — "AI" group on top, nav entries in their own group).
  const actions = useMemo(() => {
    const aiGroup = {
      group: "AI",
      actions: pageCopilotActions.map((action) => ({
        id: `ai:${action.id}`,
        label: action.label,
        description: supportsAi ? "Opens a streaming page copilot" : "Not available on this page",
        leftSection: <Bot size={16} />,
        keywords: [action.prompt],
        disabled: !supportsAi,
        onClick: () => openCopilot(action),
      })),
    };
    const navGroup = {
      group: "Navigate",
      actions: items.map((item) => ({
        id: `nav:${item.id}`,
        label: item.label,
        description: item.section,
        leftSection: <ArrowRight size={16} />,
        keywords: item.section ? [item.section] : [],
        disabled: Boolean(item.disabled),
        onClick: () => activate(item),
      })),
    };
    return [aiGroup, navGroup];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, supportsAi]);

  return (
    <>
      <Spotlight
        actions={actions}
        nothingFound="No commands found."
        searchProps={{ placeholder, "aria-label": placeholder }}
        forceOpened={open}
        onSpotlightClose={onClose}
        // Spotlight extends ModalProps; setting `title` gives the dialog
        // an accessible name via aria-labelledby (Mantine renders the
        // title as a heading). The e2e tests assert role="dialog" with
        // name="Command menu".
        title="Command menu"
        // Cmd-K is already wired by the layout (it calls onOpen on a
        // SearchBar button). Disable Spotlight's own shortcut to avoid
        // double-binding; the layout's binding wins.
        shortcut={null}
        scrollable
        maxHeight={400}
      />
      <PageCopilotDrawer
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        initialPrompt={copilotPrompt}
      />
    </>
  );
}
