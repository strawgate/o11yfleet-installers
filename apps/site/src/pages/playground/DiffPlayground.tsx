import { Suspense, lazy } from "react";
import { Container, Divider, Loader, Stack, Text, Title } from "@mantine/core";

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
  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        <Stack gap={4}>
          <Title order={2}>Config diff playground</Title>
          <Text c="dimmed" size="sm">
            Side-by-side YAML diff using react-diff-viewer-continued. Lazy-loaded — open the Network
            tab to confirm the chunk only loads when this page does.
          </Text>
        </Stack>

        <Divider />

        <Suspense fallback={<Loader />}>
          <ConfigDiffViewer left={FIXTURE_LEFT} right={FIXTURE_RIGHT} height={640} />
        </Suspense>
      </Stack>
    </Container>
  );
}
