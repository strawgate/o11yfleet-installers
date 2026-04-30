import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Bot, Sparkles } from "lucide-react";
import type { AiGuidanceIntent, AiGuidanceRequest, AiLightFetch } from "@o11yfleet/core/ai";
import {
  MAX_BROWSER_CONTEXT_LIGHT_FETCHES,
  buildBrowserGuidanceRequest,
  inferAiSurface,
  type BrowserContextLightFetch,
} from "@/ai/browser-context";
import { useBrowserContextRegistry } from "@/ai/browser-context-react";
import { includedFetch, unavailableFetch } from "@/ai/page-context";
import { apiBase } from "@/api/client";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/common/Sheet";

export type PageCopilotPrompt = {
  id: string;
  text: string;
  intent: AiGuidanceIntent;
};

export type PageCopilotAction = {
  id: string;
  label: string;
  intent: AiGuidanceIntent;
  prompt: string;
  includeLightFetches?: boolean;
};

export const pageCopilotActions: PageCopilotAction[] = [
  {
    id: "ai-ask-page",
    label: "Ask AI about this page",
    intent: "explain_page",
    prompt:
      "Explain the current page using only visible page context and approved light fetches. Call out the most important operational details and avoid generic advice.",
    includeLightFetches: true,
  },
  {
    id: "ai-next-step",
    label: "Suggest the next step",
    intent: "suggest_next_action",
    prompt:
      "Suggest the single highest-value next action from the visible page context. Be concrete and cite the visible evidence.",
    includeLightFetches: true,
  },
  {
    id: "ai-find-risks",
    label: "Find operational risks",
    intent: "triage_state",
    prompt:
      "Identify non-obvious operational risks from the visible page context. Return only risks supported by visible evidence.",
    includeLightFetches: true,
  },
];

const LIGHT_FETCH_TIMEOUT_MS = 5000;

interface PageCopilotDrawerProps {
  open: boolean;
  onClose: () => void;
  initialPrompt: PageCopilotPrompt | null;
}

export function PageCopilotDrawer({ open, onClose, initialPrompt }: PageCopilotDrawerProps) {
  const location = useLocation();
  const { capture } = useBrowserContextRegistry();
  const contextRef = useRef<AiGuidanceRequest | null>(null);
  const sentInitialPromptRef = useRef<string | null>(null);
  const sendPromptRef = useRef<(text: string, intent?: AiGuidanceIntent) => Promise<void>>(
    async () => {},
  );
  const actionByIntent = useMemo(
    () => new Map(pageCopilotActions.map((action) => [action.intent, action])),
    [],
  );
  const supportsAi = inferAiSurface(location.pathname) !== null;
  const chatPath = location.pathname.startsWith("/admin")
    ? "/api/admin/ai/chat"
    : "/api/v1/ai/chat";

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${apiBase}${chatPath}`,
        prepareSendMessagesRequest({ messages }) {
          return {
            body: {
              messages,
              context: contextRef.current,
            },
            credentials: "include",
          };
        },
      }),
    [chatPath],
  );

  const { error, messages, sendMessage, status, stop } = useChat({ transport });
  const isBusy = status === "submitted" || status === "streaming";

  const sendPrompt = useCallback(
    async (text: string, intent: AiGuidanceIntent = "explain_page") => {
      if (!supportsAi || isBusy) return;
      const snapshot = capture(location.pathname);
      const action = actionByIntent.get(intent);
      const lightFetches =
        action?.includeLightFetches === true ? await runLightFetches(snapshot.lightFetches) : [];
      const request = buildBrowserGuidanceRequest(snapshot, text, intent, { lightFetches });
      if (!request) return;
      contextRef.current = request;
      await sendMessage({ text });
    },
    [actionByIntent, capture, isBusy, location.pathname, sendMessage, supportsAi],
  );

  useEffect(() => {
    sendPromptRef.current = sendPrompt;
  }, [sendPrompt]);

  useEffect(() => {
    if (!open) {
      sentInitialPromptRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !initialPrompt || sentInitialPromptRef.current === initialPrompt.id) return;
    sentInitialPromptRef.current = initialPrompt.id;
    void sendPromptRef.current(initialPrompt.text, initialPrompt.intent);
  }, [initialPrompt, open]);

  return (
    <Sheet open={open} onClose={onClose} title="Page copilot">
      <div className="page-copilot">
        <Conversation className="page-copilot-conversation">
          <ConversationContent className="page-copilot-messages">
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={<Sparkles className="size-5" />}
                title={supportsAi ? "Ask about this page" : "AI is not available here"}
                description={
                  supportsAi
                    ? "The copilot uses the visible browser context for this page."
                    : "Open an overview, configuration, agent, builder, or tenant page."
                }
              />
            ) : (
              messages.map((message) => <CopilotMessage key={message.id} message={message} />)
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {error ? <p className="page-copilot-error">{error.message}</p> : null}

        <PromptInput
          className="page-copilot-input"
          onSubmit={({ text }) => {
            const prompt = text.trim();
            if (prompt.length > 0) {
              void sendPrompt(prompt);
            }
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              disabled={!supportsAi || isBusy}
              placeholder={
                supportsAi ? "Ask what matters on this page..." : "AI is not available here"
              }
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={!supportsAi || isBusy}
                onClick={() =>
                  void sendPrompt(
                    "Suggest the highest-value next action from the visible page context.",
                    "suggest_next_action",
                  )
                }
              >
                <Bot className="size-3" />
                Next step
              </Button>
            </PromptInputTools>
            <PromptInputSubmit disabled={!supportsAi} status={status} onStop={() => void stop()} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </Sheet>
  );
}

function CopilotMessage({ message }: { message: UIMessage }) {
  const text = messageText(message);

  if (!text) return null;

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.role === "assistant" ? <MessageResponse>{text}</MessageResponse> : text}
      </MessageContent>
    </Message>
  );
}

async function runLightFetches(
  lightFetches: BrowserContextLightFetch[] | undefined,
): Promise<AiLightFetch[]> {
  const selected = (lightFetches ?? []).slice(0, MAX_BROWSER_CONTEXT_LIGHT_FETCHES);
  return Promise.all(
    selected.map(async (fetcher) => {
      try {
        return includedFetch(
          fetcher.key,
          fetcher.label,
          await withTimeout(fetcher.load(), LIGHT_FETCH_TIMEOUT_MS),
        );
      } catch (error) {
        return unavailableFetch(
          fetcher.key,
          fetcher.label,
          error instanceof Error ? error.message : "Light fetch failed",
        );
      }
    }),
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Light fetch timed out")), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function messageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}
