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
  capabilities: number;
  component_health_map: Record<string, unknown> | null;
  available_components: Record<string, unknown> | null;
}

export interface ProcessResult {
  newState: AgentState;
  response: ServerToAgent | null;
  events: AnyFleetEvent[];
  shouldPersist: boolean;
}

/** Dependency injection for non-deterministic operations.
 *  Makes processFrame fully pure and deterministically testable. */
export interface ProcessContext {
  /** Current wall-clock time in milliseconds (replaces Date.now()). */
  now: number;
  /** Generate a random 16-byte instance UID (replaces crypto.getRandomValues). */
  randomUid: () => Uint8Array;
  /** Generate a unique event ID string (replaces crypto.randomUUID). */
  randomId: () => string;
  /** SHA-256 hash input data, returning lowercase hex. Uses crypto.subtle in production. */
  sha256: (input: BufferSource | string) => Promise<string>;
}

/** Default production context using platform crypto.subtle for hardware-accelerated SHA-256. */
export function defaultProcessContext(): ProcessContext {
  return {
    now: Date.now(),
    randomUid: () => crypto.getRandomValues(new Uint8Array(16)),
    randomId: () => crypto.randomUUID(),
    sha256: async (input: BufferSource | string): Promise<string> => {
      const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = new Uint8Array(hashBuffer);
      return Array.from(hashArray)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    },
  };
}

export type { AgentToServer, ServerToAgent };
