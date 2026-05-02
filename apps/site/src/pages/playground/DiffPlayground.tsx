import { Suspense, lazy, useCallback, useState } from "react";
import { Button, Code, Container, Divider, Group, Loader, Stack, Text, Title } from "@mantine/core";
import type { CommentThread, DiffSide } from "@/components/config-diff";
import { nanoid } from "nanoid";

const ConfigDiffViewer = lazy(() => import("@/components/config-diff/ConfigDiffViewer"));

const FIXTURE_LEFT = `receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 30s
    send_batch_size: 1000

  memory_limiter:
    check_interval: 1s
    limit_percentage: 75
    spike_limit_percentage: 25

exporters:
  otlp/backend:
    endpoint: backend.example.com:4317
    tls:
      insecure: false
    sending_queue:
      enabled: true
      num_consumers: 4
      queue_size: 1000

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/backend]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/backend]
`;

const FIXTURE_RIGHT = `receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 10s
    send_batch_size: 2000

  memory_limiter:
    check_interval: 1s
    limit_percentage: 80
    spike_limit_percentage: 25

  filter/redact:
    error_mode: ignore
    metrics:
      datapoint:
        - 'IsMatch(name, "^private\\\\..*")'

exporters:
  otlp/backend:
    endpoint: backend.example.com:4317
    tls:
      insecure: false
    sending_queue:
      enabled: true
      num_consumers: 8
      queue_size: 5000

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/backend]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, filter/redact, batch]
      exporters: [otlp/backend]
`;

export function DiffPlayground() {
  const [threads, setThreads] = useState<CommentThread[]>([
    {
      id: "thread-seed-1",
      side: "b",
      line: 16,
      comments: [
        {
          id: "c-1",
          author: "Alice",
          body: "Spike limit unchanged but the new queue_size jumped 5×.\nCheck whether downstream can absorb the burst.",
          createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        },
      ],
    },
  ]);

  const handleAddThread = useCallback((side: DiffSide, line: number) => {
    setThreads((prev) => {
      const existing = prev.find((t) => t.side === side && t.line === line);
      if (existing) return prev;
      return [
        ...prev,
        {
          id: nanoid(),
          side,
          line,
          comments: [],
        },
      ];
    });
  }, []);

  const handleSubmit = useCallback((threadId: string, body: string) => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? {
              ...t,
              comments: [
                ...t.comments,
                {
                  id: nanoid(),
                  author: "you",
                  body,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : t,
      ),
    );
  }, []);

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        <Stack gap={4}>
          <Title order={2}>Config diff playground</Title>
          <Text c="dimmed" size="sm">
            Side-by-side YAML diff with line-anchored React comment widgets.
            <strong>Alt-click</strong> any line to add a thread. Threads survive light/dark theme
            toggle without re-mounting. Lazy-loaded — open the Network tab to confirm CM6 only loads
            when this page does.
          </Text>
        </Stack>

        <Group justify="space-between">
          <Text size="sm">
            <Code>{threads.length}</Code> thread(s) ·{" "}
            <Code>{threads.reduce((n, t) => n + t.comments.length, 0)}</Code> comment(s)
          </Text>
          <Button
            size="xs"
            variant="default"
            onClick={() => setThreads([])}
            disabled={threads.length === 0}
          >
            Clear all
          </Button>
        </Group>

        <Divider />

        <Suspense fallback={<Loader />}>
          <ConfigDiffViewer
            left={FIXTURE_LEFT}
            right={FIXTURE_RIGHT}
            threads={threads}
            onAddThread={handleAddThread}
            onSubmitComment={handleSubmit}
            height={640}
          />
        </Suspense>
      </Stack>
    </Container>
  );
}
