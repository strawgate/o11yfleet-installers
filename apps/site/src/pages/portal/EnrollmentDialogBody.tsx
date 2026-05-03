import { Link } from "react-router-dom";
import { Alert, Button, Code, Group, Stack } from "@mantine/core";
import { CopyButton } from "../../components/common/CopyButton";
import { EmptyState } from "../../components/common/EmptyState";

const INSTALL_COMMAND = (token: string) =>
  `curl --proto '=https' --tlsv1.2 -fsSL https://o11yfleet.com/install.sh | bash -s -- --token ${token}`;

interface EnrollmentDialogBodyProps {
  enrollmentToken: string | null;
  enrollmentTokenError: string | null;
}

export function enrollmentTokenFailureMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string" &&
    (err as { message: string }).message.trim()
  ) {
    return (err as { message: string }).message;
  }
  return "Unknown error";
}

export function EnrollmentDialogBody({
  enrollmentToken,
  enrollmentTokenError,
}: EnrollmentDialogBodyProps) {
  if (enrollmentToken) {
    return (
      <Stack gap="md">
        <Alert color="blue" variant="light" title="Enrollment token created">
          <Stack gap="xs">
            <span>
              This token will not be shown again. Copy it now or use the install command below.
            </span>
            <Group gap="xs" wrap="nowrap">
              <Code className="token-value" style={{ flex: "1 1 auto", overflowX: "auto" }}>
                {enrollmentToken}
              </Code>
              <CopyButton value={enrollmentToken} />
            </Group>
          </Stack>
        </Alert>
        <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {INSTALL_COMMAND(enrollmentToken)}
        </Code>
        <Group gap="xs">
          <CopyButton value={INSTALL_COMMAND(enrollmentToken)} label="Copy command" />
          <Button component={Link} to="/portal/getting-started" variant="subtle" size="sm">
            Open guided setup
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      {enrollmentTokenError ? (
        <Alert color="red" variant="light" title="Could not create enrollment token" role="alert">
          {enrollmentTokenError}
        </Alert>
      ) : null}
      <EmptyState
        icon="plug"
        title="Connect a collector"
        description="Create a one-time enrollment token for this configuration, then run the installer on the host you want to manage."
      />
    </Stack>
  );
}
