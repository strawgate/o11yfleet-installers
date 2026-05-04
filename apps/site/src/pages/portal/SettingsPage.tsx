import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { zodResolver } from "mantine-form-zod-resolver";
import { notifications } from "@mantine/notifications";
import { useAuth } from "@/api/hooks/auth";
import { useDeleteTenant, useTenant, useUpdateTenant } from "@/api/hooks/portal";
import { workspaceSettingsSchema, type WorkspaceSettingsValues } from "@/api/form-schemas";
import { PageHeader, PageShell } from "@/components/app";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { getErrorMessage } from "@/utils/errors";

export default function SettingsPage() {
  const tenant = useTenant();
  const updateTenant = useUpdateTenant();
  const deleteTenant = useDeleteTenant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const seededTenantId = useRef<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const form = useForm<WorkspaceSettingsValues>({
    initialValues: { name: "", geoEnabled: false },
    validate: zodResolver(workspaceSettingsSchema),
  });

  useEffect(() => {
    if (tenant.data && tenant.data.id !== seededTenantId.current) {
      seededTenantId.current = tenant.data.id;
      form.setInitialValues({
        name: tenant.data.name,
        geoEnabled: Boolean(tenant.data["geo_enabled"]),
      });
      form.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.data]);

  if (tenant.isLoading) return <LoadingSpinner />;
  if (tenant.error) return <ErrorState error={tenant.error} retry={() => void tenant.refetch()} />;

  const t = tenant.data;

  async function handleSave(values: WorkspaceSettingsValues) {
    try {
      await updateTenant.mutateAsync({
        name: values.name,
        geo_enabled: values.geoEnabled,
      });
      notifications.show({ message: "Settings saved", color: "green" });
      form.resetDirty();
    } catch (err) {
      notifications.show({
        title: "Failed to save",
        message: getErrorMessage(err),
        color: "red",
      });
    }
  }

  async function handleDelete() {
    try {
      await deleteTenant.mutateAsync();
      notifications.show({ message: "Workspace deleted", color: "green" });
      setDeleteOpen(false);
      void navigate("/");
    } catch (err) {
      notifications.show({
        title: "Delete failed",
        message: getErrorMessage(err),
        color: "red",
      });
    }
  }

  return (
    <PageShell width="narrow">
      <PageHeader title="Settings" />

      {user ? (
        <Card mb="md">
          <Group gap="xs">
            <Badge size="sm" variant="dot" color="green">
              Signed in
            </Badge>
            <Text size="sm" c="dimmed">
              as
            </Text>
            <Text size="sm" fw={500}>
              {user.name ?? user.email}
            </Text>
          </Group>
        </Card>
      ) : null}

      <Card>
        <Title order={3} size="sm" fw={500} mb="md">
          General
        </Title>
        <form onSubmit={form.onSubmit(handleSave)}>
          <Stack gap="md">
            <TextInput label="Workspace name" {...form.getInputProps("name")} />
            <TextInput
              label="Workspace ID"
              description="Read-only identifier for your workspace."
              styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
              value={t?.id ?? ""}
              readOnly
            />
            <Switch
              label="Geo-IP collection"
              description="Collect IP address and approximate geographic location of collectors."
              {...form.getInputProps("geoEnabled", { type: "checkbox" })}
            />
            <Group>
              <Button type="submit" loading={updateTenant.isPending} disabled={!form.isDirty()}>
                Save changes
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>

      <Card mt="md">
        <Title order={3} size="sm" fw={500}>
          Remote config authority
        </Title>
        <Text size="sm" c="dimmed" mt="xs">
          This workspace can assign desired config to enrolled collectors. Enrollment tokens are
          bootstrap-only secrets; future API tokens should be scoped separately for automation.
        </Text>
      </Card>

      <Card mt="md" withBorder style={{ borderColor: "var(--mantine-color-red-7)" }}>
        <Title order={3} size="sm" fw={500} c="red">
          Danger zone
        </Title>
        <Group justify="space-between" align="flex-start" mt="md" wrap="wrap">
          <Stack gap={4} style={{ flex: "1 1 16rem" }}>
            <Text size="sm" fw={500}>
              Delete workspace
            </Text>
            <Text size="sm" c="dimmed">
              Permanently delete this workspace and all its data. This action cannot be undone.
            </Text>
          </Stack>
          <Button color="red" onClick={() => setDeleteOpen(true)}>
            Delete workspace
          </Button>
        </Group>
      </Card>

      <Modal
        opened={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setConfirmText("");
        }}
        title="Delete workspace"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Type{" "}
            <Text span fw={600} c="bright">
              delete
            </Text>{" "}
            to confirm.
          </Text>
          <TextInput
            value={confirmText}
            onChange={(event) => setConfirmText(event.currentTarget.value)}
            placeholder="delete"
            autoFocus
          />
          <Group justify="flex-end" gap="xs">
            <Button
              variant="default"
              onClick={() => {
                setDeleteOpen(false);
                setConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => void handleDelete()}
              disabled={confirmText !== "delete"}
              loading={deleteTenant.isPending}
            >
              Delete permanently
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageShell>
  );
}
