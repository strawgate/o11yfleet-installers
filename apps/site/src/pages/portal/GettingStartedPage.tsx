import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router";
import {
  Alert,
  Box,
  Button,
  Card,
  Code,
  Group,
  Indicator,
  Select,
  Stack,
  Stepper,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  useConfigurations,
  useCreateEnrollmentToken,
  useConfigurationStats,
} from "../../api/hooks/portal";
import { CopyButton } from "../../components/common/CopyButton";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { EmptyState, PageHeader, PageShell } from "@/components/app";
import { configurationAgentMetrics } from "../../utils/config-stats";
import installScriptSource from "../../../install.sh?raw";
import { getErrorMessage } from "@/utils/errors";

const INSTALL_SH = (token: string) =>
  `curl --proto '=https' --tlsv1.2 -fsSL https://o11yfleet.com/install.sh | bash -s -- --token ${token}`;

const DOWNLOAD_INSTALL_SH = (token: string) =>
  `curl --proto '=https' --tlsv1.2 -fsSLO https://o11yfleet.com/install.sh
chmod +x install.sh
./install.sh --token ${token}`;

const INSTALL_PS1 = (token: string) =>
  `irm https://o11yfleet.com/install.ps1 -OutFile install.ps1; .\\install.ps1 -Token "${token}"`;

type InstallTab = "quick" | "download" | "script" | "windows" | "manual";

export default function GettingStartedPage() {
  const { data: configs, isLoading, error, refetch } = useConfigurations();

  const [step, setStep] = useState(0);
  const [selectedConfigId, setSelectedConfigId] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [installTab, setInstallTab] = useState<InstallTab>("quick");
  const [connected, setConnected] = useState(false);

  const tokenConfigId = selectedConfigId || "__none__";
  const createToken = useCreateEnrollmentToken(tokenConfigId);
  // Polls stats every 5s while step 3 is open and we haven't seen the
  // collector connect yet. TanStack Query's refetchInterval handles
  // dedup + lifecycle; previously this was a manual setInterval (#781).
  const stats = useConfigurationStats(step >= 3 ? selectedConfigId : undefined, {
    refetchInterval: step === 3 && !connected ? 5000 : false,
  });
  const agentMetrics = useMemo(() => configurationAgentMetrics(stats.data, [], null), [stats.data]);

  useEffect(() => {
    if (configs && configs.length > 0 && !selectedConfigId) {
      setSelectedConfigId(configs[0]!.id);
    }
  }, [configs, selectedConfigId]);

  useEffect(() => {
    if (step !== 3 || !stats.data) return;
    if (agentMetrics.connectedAgents > 0) {
      setConnected(true);
    }
  }, [agentMetrics.connectedAgents, step, stats.data]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const cfgList = configs ?? [];
  const configOptions = cfgList.map((c) => ({ value: c.id, label: c.name }));

  async function handleGenerateToken() {
    if (!selectedConfigId) return;
    try {
      const result = await createToken.mutateAsync({ label: "getting-started" });
      if (result.token) {
        setToken(result.token);
        setStep(2);
      }
    } catch (err) {
      notifications.show({
        title: "Failed to generate token",
        message: getErrorMessage(err),
        color: "red",
      });
    }
  }

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Getting started"
        description="First success means a collector enrolls, connects, and reports state. Generating a token is only the bootstrap step."
      />

      <Stepper active={step} onStepClick={setStep} mb="lg" allowNextStepsSelect={false}>
        <Stepper.Step label="Choose group" />
        <Stepper.Step label="Get token" />
        <Stepper.Step label="Install" />
        <Stepper.Step label="First success" />
      </Stepper>

      {step === 0 && (
        <Card>
          <Title order={3} size="sm" fw={500}>
            Choose a configuration group
          </Title>
          <Text size="sm" c="dimmed" mt="xs">
            A configuration group is the assignment boundary. Collectors enrolled with its token
            should converge to the group&apos;s desired config.
          </Text>
          {cfgList.length === 0 ? (
            <EmptyState
              icon="file"
              title="No configurations found"
              description="Create a configuration before generating an enrollment token."
            >
              <Button component={Link} to="/portal/configurations" size="sm">
                Create configuration
              </Button>
            </EmptyState>
          ) : (
            <Stack gap="md" mt="md">
              <Select
                label="Configuration"
                value={selectedConfigId}
                onChange={(v) => setSelectedConfigId(v ?? "")}
                data={configOptions}
                allowDeselect={false}
              />
              <Group>
                <Button
                  onClick={() => setStep(1)}
                  disabled={!selectedConfigId}
                  aria-describedby={!selectedConfigId ? "step1-help" : undefined}
                >
                  Continue
                </Button>
                {!selectedConfigId ? (
                  <span id="step1-help" className="sr-only">
                    Select a configuration to continue
                  </span>
                ) : null}
              </Group>
            </Stack>
          )}
        </Card>
      )}

      {step === 1 && (
        <Card>
          <Title order={3} size="sm" fw={500}>
            Enrollment token
          </Title>
          <Text size="sm" c="dimmed" mt="xs">
            Generate a bootstrap token for first enrollment. After enrollment, the collector uses a
            scoped assignment claim for management traffic.
          </Text>
          <Group mt="md">
            <Button onClick={() => void handleGenerateToken()} loading={createToken.isPending}>
              Generate token
            </Button>
          </Group>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <Title order={3} size="sm" fw={500}>
            Install &amp; connect
          </Title>
          <Text size="sm" c="dimmed" mt="xs">
            Run one of the commands below to install the OpenTelemetry Collector on your host and
            point it at O11yFleet OpAMP management.
          </Text>

          {token && (
            <Alert mt="md" color="blue" variant="light" title="Your enrollment token">
              <Group gap="xs" mt="xs" wrap="nowrap">
                <Code
                  style={{
                    flex: "1 1 auto",
                    maxWidth: "100%",
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                  }}
                >
                  {token}
                </Code>
                <CopyButton value={token} />
              </Group>
            </Alert>
          )}

          <Tabs value={installTab} onChange={(v) => v && setInstallTab(v as InstallTab)} mt="md">
            <Tabs.List>
              <Tabs.Tab value="quick">Pipe to bash</Tabs.Tab>
              <Tabs.Tab value="download">Download script</Tabs.Tab>
              <Tabs.Tab value="script">install.sh</Tabs.Tab>
              <Tabs.Tab value="windows">Windows</Tabs.Tab>
              <Tabs.Tab value="manual">Manual</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="quick" pt="md">
              <CommandBlock value={INSTALL_SH(token)} label="Copy command" />
            </Tabs.Panel>
            <Tabs.Panel value="download" pt="md">
              <CommandBlock value={DOWNLOAD_INSTALL_SH(token)} label="Copy command" />
            </Tabs.Panel>
            <Tabs.Panel value="script" pt="md">
              <CommandBlock value={installScriptSource} label="Copy install.sh" />
            </Tabs.Panel>
            <Tabs.Panel value="windows" pt="md">
              <CommandBlock value={INSTALL_PS1(token)} label="Copy command" />
            </Tabs.Panel>
            <Tabs.Panel value="manual" pt="md">
              <CommandBlock
                value={`# 1. Download the collector binary for your platform
# 2. Create the configuration file:
#    /etc/o11yfleet/config.yaml
#
# 3. Set the enrollment token:
#    export O11YFLEET_TOKEN="${token}"
#
# 4. Start the collector:
#    o11yfleet-collector --config /etc/o11yfleet/config.yaml`}
                label="Copy commands"
              />
            </Tabs.Panel>
          </Tabs>

          <Group mt="md">
            <Button onClick={() => setStep(3)}>I&apos;ve installed the collector</Button>
          </Group>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <Title order={3} size="sm" fw={500}>
            Confirm first successful connection
          </Title>
          {connected ? (
            <Stack gap="md" mt="md">
              <Group gap="xs">
                <Indicator color="green" size={10} />
                <Text size="sm">Collector connected and reporting.</Text>
              </Group>
              <Group gap="xs">
                <Button component={Link} to="/portal/overview">
                  Go to overview
                </Button>
                <Button component={Link} to="/portal/agents" variant="default">
                  View agents
                </Button>
              </Group>
            </Stack>
          ) : (
            <Stack gap="md" mt="md">
              <Group gap="xs">
                <Indicator color="yellow" processing size={10} />
                <Text size="sm" c="dimmed">
                  Waiting for first collector heartbeat…
                </Text>
              </Group>
              <Text size="sm" c="dimmed">
                This page polls automatically every 5 seconds.
              </Text>
              <Alert color="yellow" variant="light" title="No connection yet?">
                Check that the token was copied without quotes, the host can reach the OpAMP
                endpoint, and the collector process is running.
              </Alert>
              <Group>
                <Button component={Link} to="/portal/overview" variant="subtle" size="sm">
                  Skip — go to overview
                </Button>
              </Group>
            </Stack>
          )}
        </Card>
      )}
    </PageShell>
  );
}

function CommandBlock({ value, label }: { value: string; label: string }) {
  return (
    <Box>
      <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {value}
      </Code>
      <Group mt="xs">
        <CopyButton value={value} label={label} />
      </Group>
    </Box>
  );
}
