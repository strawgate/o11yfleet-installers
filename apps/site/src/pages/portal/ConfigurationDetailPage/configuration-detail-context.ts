import { useOutletContext } from "react-router";
import type {
  Configuration,
  ConfigVersion,
  EnrollmentToken,
  Agent,
  useConfigurationAgents,
  useConfigurationVersions,
  useConfigurationYaml,
  useRolloutConfig,
  useRestartConfiguration,
  useDisconnectConfiguration,
} from "@/api/hooks/portal";
import type { usePortalGuidance } from "@/api/hooks/ai";
import type { AiGuidanceIntent } from "@o11yfleet/core/ai";

export type RunCopilot = (
  title: string,
  intent: AiGuidanceIntent,
  userPrompt: string,
  lightFetchMode?: "version-diff" | "rollout-summary",
) => Promise<void>;

export type ConfigurationDetailOutletContext = {
  configuration: Configuration;
  configId: string;

  // Lazy queries — used by the tabs that mount on their respective routes.
  agentsQuery: ReturnType<typeof useConfigurationAgents>;
  versionsQuery: ReturnType<typeof useConfigurationVersions>;
  yamlQuery: ReturnType<typeof useConfigurationYaml>;

  // Lists (memoized in orchestrator so each tab gets stable refs).
  agentList: Agent[];
  versionList: ConfigVersion[];
  tokenList: EnrollmentToken[];

  // Pagination cursor for AgentsTab — kept in orchestrator because the
  // agents query lives there (it feeds the metric cards' agent counts).
  agentCursor: string | undefined;
  setAgentCursor: (cursor: string | undefined) => void;

  // Model slices used across tabs.
  desiredHash: string | null;
  connectedAgents: number | null;
  totalAgents: number | null;
  activeWebSockets: number | null;
  hasConfigContent: boolean;

  // Mutations / actions that originate inside tabs.
  rollout: ReturnType<typeof useRolloutConfig>;
  restartFleet: ReturnType<typeof useRestartConfiguration>;
  disconnectFleet: ReturnType<typeof useDisconnectConfiguration>;

  // Cross-tab handlers owned by the orchestrator.
  openEnrollDialog: () => void;
  openDeleteDialog: () => void;
  openRolloutConfirm: () => void;
  openRestartFleetConfirm: () => void;
  openDisconnectFleetConfirm: () => void;
  runCopilot: RunCopilot;
  copilotIsLoading: boolean;
  guidance: ReturnType<typeof usePortalGuidance>;
};

export function useConfigurationDetailContext(): ConfigurationDetailOutletContext {
  return useOutletContext<ConfigurationDetailOutletContext>();
}
