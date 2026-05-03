import { Alert, Card, Stack, Text, Title } from "@mantine/core";
import type { BuilderValidation } from "@/pages/portal/useBuilderState";

export interface ValidationStripProps {
  validation: BuilderValidation;
  yamlPreviewError: string | null;
}

function IssueAlert({
  color,
  title,
  body,
}: {
  color: "red" | "yellow" | "green";
  title: string;
  body: string;
}) {
  return (
    <Alert color={color} variant="light" title={title}>
      {body}
    </Alert>
  );
}

export function ValidationStrip({ validation, yamlPreviewError }: ValidationStripProps) {
  const hasErrors = yamlPreviewError !== null || validation.errors.length > 0;
  const hasWarnings = validation.warnings.length > 0;
  const noIssues = !hasErrors && !hasWarnings;

  return (
    <Card mt="md" className="pipe-validation-strip">
      <Title order={3} size="sm">
        Validation and rollout readiness
      </Title>
      <Text size="sm" c="dimmed" mt="xs">
        Graph checks run locally from the model. Collector runtime validation and rollout gates are
        separate backend contracts.
      </Text>

      <Stack gap="sm" mt="md">
        {!validation.canSave ? (
          <IssueAlert
            color="red"
            title="Cannot save draft"
            body="Please resolve all errors before saving."
          />
        ) : null}

        {yamlPreviewError !== null ? (
          <IssueAlert color="red" title="YAML preview unavailable" body={yamlPreviewError} />
        ) : null}

        {noIssues ? (
          <IssueAlert
            color="green"
            title="No graph issues detected"
            body="Review the generated YAML before creating a version."
          />
        ) : null}

        {validation.errors.length > 0 ? (
          <details open>
            <summary
              style={{
                fontSize: "var(--mantine-font-size-sm)",
                fontWeight: 600,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              Errors ({validation.errors.length})
            </summary>
            <Stack gap="xs" mt="xs">
              {validation.errors.map((issue, index) => (
                <IssueAlert
                  key={`error-${index}-${issue.code}`}
                  color="red"
                  title={`Error: ${issue.code}`}
                  body={issue.message}
                />
              ))}
            </Stack>
          </details>
        ) : null}

        {validation.warnings.length > 0 ? (
          <details open>
            <summary
              style={{
                fontSize: "var(--mantine-font-size-sm)",
                fontWeight: 600,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              Warnings ({validation.warnings.length})
            </summary>
            <Stack gap="xs" mt="xs">
              {validation.warnings.map((issue, index) => (
                <IssueAlert
                  key={`warning-${index}-${issue.code}`}
                  color="yellow"
                  title={`Warning: ${issue.code}`}
                  body={issue.message}
                />
              ))}
            </Stack>
          </details>
        ) : null}
      </Stack>
    </Card>
  );
}
