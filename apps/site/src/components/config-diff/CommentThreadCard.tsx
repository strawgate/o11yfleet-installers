import { useState } from "react";
import { Avatar, Button, Group, Paper, Stack, Text, Textarea } from "@mantine/core";
import type { CommentThread } from "./types";
import type { CommentWidgetCallbacks } from "./CommentWidget";

export function CommentThreadCard({
  thread,
  callbacks,
}: {
  thread: CommentThread;
  callbacks: CommentWidgetCallbacks;
}) {
  const [draft, setDraft] = useState(thread.draft ?? "");

  return (
    <Paper
      withBorder
      radius="sm"
      p="xs"
      m="xs"
      style={{ borderLeftWidth: 3, borderLeftColor: "var(--mantine-color-brand-5)" }}
    >
      <Stack gap="xs">
        {thread.comments.map((c) => (
          <Group key={c.id} gap="xs" align="flex-start" wrap="nowrap">
            <Avatar size="xs" radius="xl">
              {c.author.slice(0, 1).toUpperCase()}
            </Avatar>
            <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
              <Group gap={4}>
                <Text size="xs" fw={500}>
                  {c.author}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatTime(c.createdAt)}
                </Text>
              </Group>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {c.body}
              </Text>
            </Stack>
          </Group>
        ))}

        <Textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            callbacks.onDraftChange(e.currentTarget.value);
          }}
          placeholder={thread.comments.length === 0 ? "Start the discussion…" : "Reply…"}
          size="sm"
          autosize
          minRows={2}
          maxRows={6}
        />
        <Group justify="flex-end" gap="xs">
          <Button
            size="xs"
            variant="default"
            disabled={!draft.trim()}
            onClick={() => {
              if (!draft.trim()) return;
              callbacks.onSubmit(draft.trim());
              setDraft("");
            }}
          >
            Comment
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
