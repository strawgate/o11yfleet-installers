import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { inferAiSurface } from "@/ai/browser-context";
import {
  PageCopilotDrawer,
  pageCopilotActions,
  type PageCopilotPrompt,
} from "@/components/ai/PageCopilotDrawer";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem as CommandMenuItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

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

export function CommandPalette({ open, onClose, items, placeholder }: CommandPaletteProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotPrompt, setCopilotPrompt] = useState<PageCopilotPrompt | null>(null);
  const supportsAi = inferAiSurface(location.pathname) !== null;

  function activate(item: CommandItem) {
    if (item.disabled) return;
    navigate(item.href);
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

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onClose();
        }}
        title="Command menu"
        description="Search pages and run page-aware AI commands."
      >
        <CommandInput aria-label={placeholder} placeholder={placeholder} />
        <CommandList>
          <CommandEmpty>No commands found.</CommandEmpty>
          <CommandGroup heading="AI">
            {pageCopilotActions.map((action) => (
              <CommandMenuItem
                key={action.id}
                value={`${action.label} ai ${action.prompt}`}
                disabled={!supportsAi}
                onSelect={() => openCopilot(action)}
              >
                <span className="grid min-w-0 gap-0.5">
                  <span>{action.label}</span>
                  <span className="text-xs text-muted-foreground">
                    Opens a streaming page copilot
                  </span>
                </span>
                {!supportsAi ? (
                  <span className="ml-auto text-xs text-muted-foreground">Soon</span>
                ) : null}
              </CommandMenuItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Navigate">
            {items.map((item) => (
              <CommandMenuItem
                key={item.id}
                value={`${item.section ?? ""} ${item.label}`}
                disabled={item.disabled}
                onSelect={() => activate(item)}
              >
                <span className="grid min-w-0 gap-0.5">
                  <span>{item.label}</span>
                  {item.section ? (
                    <span className="font-mono text-xs text-muted-foreground">{item.section}</span>
                  ) : null}
                </span>
                {item.disabled ? (
                  <span className="ml-auto text-xs text-muted-foreground">Soon</span>
                ) : null}
              </CommandMenuItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <PageCopilotDrawer
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        initialPrompt={copilotPrompt}
      />
    </>
  );
}
