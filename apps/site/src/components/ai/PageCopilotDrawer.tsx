import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Bot, Sparkles, ArrowDown, Send, Square } from "lucide-react";
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Drawer,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { Streamdown } from "streamdown";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
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
    <Drawer
      opened={open}
      onClose={onClose}
      title="Page copilot"
      position="right"
      size="md"
      withCloseButton
      closeButtonProps={{ "aria-label": "Close" }}
      // The drawer body needs to fill the remaining height under the header
      // so the inner scroll area + prompt-form layout work. Mantine's body
      // is `flex: 1 1 auto` by default; setting display:flex + h:100% on
      // its inner Stack lets the conversation stream grow and the prompt
      // pin to the bottom without hard-coding the header offset.
      styles={{ body: { display: "flex", flexDirection: "column", height: "100%" } }}
    >
      <Stack gap={0} h="100%" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <ConversationStream messages={messages} supportsAi={supportsAi} />

        {error ? (
          <Alert color="red" variant="light" m="sm">
            {error.message}
          </Alert>
        ) : null}

        <PromptForm
          supportsAi={supportsAi}
          isBusy={isBusy}
          status={status}
          onStop={() => void stop()}
          onSubmit={(text) => {
            const prompt = text.trim();
            if (prompt.length > 0) void sendPrompt(prompt);
          }}
          onNextStep={() =>
            void sendPrompt(
              "Suggest the highest-value next action from the visible page context.",
              "suggest_next_action",
            )
          }
        />
      </Stack>
    </Drawer>
  );
}

function ConversationStream({
  messages,
  supportsAi,
}: {
  messages: UIMessage[];
  supportsAi: boolean;
}) {
  return (
    <StickToBottom
      role="log"
      initial="smooth"
      resize="smooth"
      style={{ flex: 1, position: "relative", overflowY: "hidden" }}
    >
      <StickToBottom.Content
        style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}
      >
        {messages.length === 0 ? (
          <EmptyState supportsAi={supportsAi} />
        ) : (
          messages.map((message) => <CopilotMessage key={message.id} message={message} />)
        )}
      </StickToBottom.Content>
      <ScrollToBottomButton />
    </StickToBottom>
  );
}

function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <ActionIcon
      onClick={() => void scrollToBottom()}
      variant="default"
      size="lg"
      radius="xl"
      aria-label="Scroll to latest message"
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
      }}
    >
      <ArrowDown size={16} />
    </ActionIcon>
  );
}

function EmptyState({ supportsAi }: { supportsAi: boolean }) {
  return (
    <Stack align="center" justify="center" gap="xs" h="100%" p="xl" ta="center">
      <Sparkles size={20} color="var(--mantine-color-dimmed)" />
      <Title order={4} size="sm" fw={500}>
        {supportsAi ? "Ask about this page" : "AI is not available here"}
      </Title>
      <Text size="sm" c="dimmed">
        {supportsAi
          ? "The copilot uses the visible browser context for this page."
          : "Open an overview, configuration, agent, builder, or tenant page."}
      </Text>
    </Stack>
  );
}

function CopilotMessage({ message }: { message: UIMessage }) {
  const text = messageText(message);
  if (!text) return null;
  const isAssistant = message.role === "assistant";
  return (
    <Box style={{ display: "flex", justifyContent: isAssistant ? "flex-start" : "flex-end" }}>
      <Paper
        withBorder={isAssistant}
        bg={isAssistant ? undefined : "var(--mantine-primary-color-light)"}
        p="sm"
        radius="md"
        style={{ maxWidth: "85%" }}
      >
        {isAssistant ? <Streamdown>{text}</Streamdown> : <Text size="sm">{text}</Text>}
      </Paper>
    </Box>
  );
}

interface PromptFormProps {
  supportsAi: boolean;
  isBusy: boolean;
  status: ReturnType<typeof useChat>["status"];
  onStop: () => void;
  onSubmit: (text: string) => void;
  onNextStep: () => void;
}

function PromptForm({ supportsAi, isBusy, status, onStop, onSubmit, onNextStep }: PromptFormProps) {
  const textRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = textRef.current?.value ?? "";
    onSubmit(text);
    if (textRef.current) textRef.current.value = "";
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const form = event.currentTarget.form;
      if (form) form.requestSubmit();
    }
  }

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      p="sm"
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
    >
      <Textarea
        ref={textRef}
        placeholder={supportsAi ? "Ask what matters on this page..." : "AI is not available here"}
        disabled={!supportsAi || isBusy}
        autosize
        minRows={2}
        maxRows={6}
        onKeyDown={handleKeyDown}
      />
      <Group justify="space-between" mt="xs">
        <Button
          type="button"
          variant="subtle"
          size="xs"
          leftSection={<Bot size={12} />}
          disabled={!supportsAi || isBusy}
          onClick={onNextStep}
        >
          Next step
        </Button>
        {isBusy ? (
          <Button
            type="button"
            color="red"
            variant="light"
            size="xs"
            leftSection={<Square size={12} />}
            onClick={onStop}
          >
            {status === "streaming" ? "Stop streaming" : "Cancel"}
          </Button>
        ) : (
          <Button type="submit" size="xs" leftSection={<Send size={12} />} disabled={!supportsAi}>
            Send
          </Button>
        )}
      </Group>
    </Box>
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
