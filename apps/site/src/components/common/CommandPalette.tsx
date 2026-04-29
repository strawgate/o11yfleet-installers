import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AiGuidanceIntent, AiGuidanceItem, AiGuidanceResponse } from "@o11yfleet/core/ai";
import { ApiError, apiPost } from "@/api/client";
import { buildBrowserGuidanceRequest, inferAiSurface } from "@/ai/browser-context";
import { useBrowserContextRegistry } from "@/ai/browser-context-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem as CommandMenuItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { GuidanceBadge } from "@/components/ai/GuidanceBadge";

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

type AiAction = {
  id: string;
  label: string;
  intent: AiGuidanceIntent;
  prompt: string;
};

type AiCommandState =
  | { status: "idle" }
  | { status: "loading"; label: string }
  | { status: "success"; label: string; guidance: AiGuidanceResponse }
  | { status: "error"; label: string; message: string };

const aiActions: AiAction[] = [
  {
    id: "ai-explain-page",
    label: "Explain this page",
    intent: "explain_page",
    prompt:
      "Explain what is visible on this page. Call out the most important operational details and avoid generic advice.",
  },
  {
    id: "ai-next-step",
    label: "Suggest the next step",
    intent: "suggest_next_action",
    prompt:
      "Suggest the single highest-value next action from the visible page context. Be concrete and cite the visible evidence.",
  },
  {
    id: "ai-find-risks",
    label: "Find operational risks",
    intent: "triage_state",
    prompt:
      "Identify non-obvious operational risks from the visible page context. Return only risks supported by visible evidence.",
  },
];

export function CommandPalette({ open, onClose, items, placeholder }: CommandPaletteProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { capture } = useBrowserContextRegistry();
  const [aiState, setAiState] = useState<AiCommandState>({ status: "idle" });
  const aiRequestId = useRef(0);
  const openRef = useRef(open);
  const supportsAi = inferAiSurface(location.pathname) !== null;

  useEffect(() => {
    openRef.current = open;
    if (!open) {
      aiRequestId.current += 1;
      setAiState({ status: "idle" });
    }
  }, [open]);

  function activate(item: CommandItem) {
    if (item.disabled) return;
    navigate(item.href);
    onClose();
  }

  async function runAiAction(action: AiAction) {
    if (!supportsAi) {
      setAiState({
        status: "error",
        label: action.label,
        message:
          "AI commands are available on overview, configuration, agent, builder, and tenant pages.",
      });
      return;
    }

    const snapshot = capture(location.pathname);
    const request = buildBrowserGuidanceRequest(snapshot, action.prompt, action.intent);
    if (!request) {
      setAiState({
        status: "error",
        label: action.label,
        message: "This page does not expose enough browser context for an AI request yet.",
      });
      return;
    }

    const path = location.pathname.startsWith("/admin")
      ? "/api/admin/ai/guidance"
      : "/api/v1/ai/guidance";

    const requestId = (aiRequestId.current += 1);
    setAiState({ status: "loading", label: action.label });
    try {
      const guidance = await apiPost<AiGuidanceResponse>(path, request);
      if (openRef.current && aiRequestId.current === requestId) {
        setAiState({ status: "success", label: action.label, guidance });
      }
    } catch (error) {
      if (openRef.current && aiRequestId.current === requestId) {
        setAiState({
          status: "error",
          label: action.label,
          message:
            error instanceof ApiError
              ? error.message
              : "AI guidance is unavailable for this page right now.",
        });
      }
    }
  }

  return (
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
          {aiActions.map((action) => (
            <CommandMenuItem
              key={action.id}
              value={`${action.label} ai ${action.prompt}`}
              disabled={!supportsAi || aiState.status === "loading"}
              onSelect={() => void runAiAction(action)}
            >
              <span className="grid min-w-0 gap-0.5">
                <span>{action.label}</span>
                <span className="text-xs text-muted-foreground">
                  Uses the browser-visible page context
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
      <AiCommandResult state={aiState} />
    </CommandDialog>
  );
}

function AiCommandResult({ state }: { state: AiCommandState }) {
  if (state.status === "idle") return null;

  return (
    <div className="border-t border-border bg-background/80 p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
        {state.label}
      </div>
      {state.status === "loading" ? (
        <p className="text-sm text-muted-foreground">Reading the current page context...</p>
      ) : null}
      {state.status === "error" ? (
        <p className="text-sm text-destructive">{state.message}</p>
      ) : null}
      {state.status === "success" ? <AiGuidancePreview guidance={state.guidance} /> : null}
    </div>
  );
}

function AiGuidancePreview({ guidance }: { guidance: AiGuidanceResponse }) {
  const items = guidance.items.slice(0, 3);

  return (
    <div className="grid gap-2">
      <p className="text-sm text-foreground">{guidance.summary}</p>
      {items.length > 0 ? (
        <div className="grid gap-2">
          {items.map((item, index) => (
            <AiGuidancePreviewItem
              key={`${item.target_key}:${item.headline}:${index}`}
              item={item}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AiGuidancePreviewItem({ item }: { item: AiGuidanceItem }) {
  return (
    <article className="rounded-md border border-border bg-card p-2.5">
      <div className="mb-1 flex items-center gap-2 text-sm">
        <GuidanceBadge severity={item.severity} />
        <strong className="font-medium">{item.headline}</strong>
      </div>
      <p className="text-sm text-muted-foreground">{item.detail}</p>
    </article>
  );
}
