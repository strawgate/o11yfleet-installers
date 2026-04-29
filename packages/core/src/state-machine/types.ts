// State machine types

import type { AgentToServer, ServerToAgent } from "../codec/types.js";
import type { AnyFleetEvent } from "../events.js";

export interface AgentState {
  instance_uid: Uint8Array;
  tenant_id: string;
  config_id: string;
  sequence_num: number;
  generation: number;
  healthy: boolean;
  status: string;
  last_error: string;
  current_config_hash: Uint8Array | null;
  desired_config_hash: Uint8Array | null;
  effective_config_hash: string | null;
  effective_config_body: string | null;
  last_seen_at: number;
  connected_at: number;
  agent_description: string | null;
  capabilities: number; // C3 fix: stored agent capabilities
}

export interface ProcessResult {
  newState: AgentState;
  response: ServerToAgent | null;
  events: AnyFleetEvent[];
  shouldPersist: boolean;
}

export type { AgentToServer, ServerToAgent };
