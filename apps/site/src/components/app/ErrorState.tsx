import { Button, Center, Stack, Text } from "@mantine/core";
import { CircleAlert } from "lucide-react";

export interface ErrorStateProps {
  /** Error object with message */
  error?: Error | null;
  /** Fallback message string (for data-table ErrorState compatibility) */
  message?: string;
  /** Retry callback function */
  retry?: () => void;
  /** Height constraint for table-like containers */
  height?: number | string;
}

/**
 * Error state display component. Shows an error message with an optional retry button.
 * Supports both Error object input and plain message string for compatibility.
 */
export function ErrorState({ error, message, retry, height }: ErrorStateProps) {
  const displayMessage = error?.message ?? message ?? "Something went wrong";

  return (
    <Center h={height} py={height ? "md" : 64} px="md">
      <Stack align="center" gap="md" maw={420}>
        <CircleAlert size={32} color="var(--mantine-color-err-5)" aria-hidden />
        <Text size="sm" fw={500}>
          {displayMessage}
        </Text>
        {retry ? (
          <Button size="xs" variant="default" onClick={retry}>
            Try again
          </Button>
        ) : null}
      </Stack>
    </Center>
  );
}
