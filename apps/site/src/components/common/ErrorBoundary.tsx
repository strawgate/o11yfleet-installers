import { Component, type ReactNode } from "react";
import { Button, Stack, Text, Title } from "@mantine/core";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <Stack align="center" gap="sm" p="xl" ta="center">
            <Title order={2}>Something went wrong</Title>
            <Text c="dimmed">{this.state.error?.message ?? "An unexpected error occurred"}</Text>
            <Button
              size="xs"
              variant="default"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              Reload page
            </Button>
          </Stack>
        )
      );
    }
    return this.props.children;
  }
}
