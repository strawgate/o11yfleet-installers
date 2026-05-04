import { useOutletContext } from "react-router";
import type { AgentDetail, AgentDescription } from "@/api/hooks/portal";
import type { PipelineTopology, extractAgentIdentity } from "@/utils/pipeline";
import type {
  ComponentInventory,
  ComponentSummary,
  ConfigSyncView,
} from "@/pages/portal/agent-detail-model";

export type AgentIdentity = ReturnType<typeof extractAgentIdentity>;

export type AgentDetailOutletContext = {
  agent: AgentDetail;
  agentDesc: AgentDescription | null;
  agentUid: string;
  identity: AgentIdentity;
  topology: PipelineTopology | null;
  healthy: boolean | null;
  isConnected: boolean | null;
  configSync: ConfigSyncView;
  desiredHash: string | undefined;
  currentHash: string | null | undefined;
  capabilities: string[];
  componentCounts: ComponentSummary;
  componentInventory: ComponentInventory | null;
};

export function useAgentDetailContext(): AgentDetailOutletContext {
  return useOutletContext<AgentDetailOutletContext>();
}
