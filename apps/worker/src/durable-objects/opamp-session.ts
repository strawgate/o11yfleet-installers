/**
 * OpAMP session handling helpers.
 *
 * Provides utilities for processing the first WebSocket message from an agent,
 * including enrollment (initial connection) and reconnection flows.
 *
 * - Enrollment: agent sends a first message without a claim; we decode it,
 *   generate a claim with a DO-assigned UID, and instruct the agent to reconnect.
 * - Reconnect: agent sends a first message with an existing claim; we validate
 *   it and optionally refresh the connection settings offer if the agent supports
 *   OpAMP connection settings negotiation.
 */

import {
  AgentCapabilities,
  decodeAgentToServer,
  encodeServerToAgent,
  ServerErrorResponseType,
  type ServerToAgent,
} from "@o11yfleet/core/codec";
import { signClaim } from "@o11yfleet/core/auth";
import type { AssignmentClaim } from "@o11yfleet/core/auth";
import { hexToUint8Array } from "@o11yfleet/core/hex";
import type { AgentStateRepository } from "./agent-state-repo-interface.js";
import type { WSAttachment } from "./ws-attachment.js";
import { ASSIGNMENT_CLAIM_TTL_SECONDS, SERVER_CAPABILITIES } from "./constants.js";

export interface SessionContext {
  /** Agent state repository for persistence. */
  repo: AgentStateRepository;
  /** HMAC secret for signing assignment claims. */
  hmacSecret: string;
  /** Callback to schedule the DO alarm after state changes. */
  ensureAlarm: () => Promise<void>;
}

/**
 * Process the first WebSocket message from an OpAMP agent.
 *
 * Handles both initial enrollment (no prior claim) and reconnection (valid claim):
 * - **Enrollment**: Decodes the agent's first message, assigns a DO-generated UID,
 *   signs an assignment claim, and returns AgentIdentification to tell the agent
 *   to reconnect with the new UID.
 * - **Reconnect**: Validates the existing claim, optionally refreshes the connection
 *   settings offer if the agent supports OpAMP connection settings negotiation.
 *
 * @param ctx - Session context with repo and HMAC secret.
 * @param ws - Agent's WebSocket.
 * @param attachment - Parsed WS attachment with enrollment flags.
 * @param message - Raw binary first message from the agent.
 * @returns Updated attachment, earlyReturn flag, and optionally AgentIdentification bytes.
 */
export async function handleFirstMessage(
  ctx: SessionContext,
  ws: WebSocket,
  attachment: WSAttachment,
  message: ArrayBuffer,
): Promise<{ attachment: WSAttachment; earlyReturn: boolean; agentIdentification?: Uint8Array }> {
  if (attachment.is_enrollment) {
    try {
      // The agent sends an AgentToServer with its self-reported UID; we decode
      // here to satisfy the protocol but ignore the value. The DO-assigned UID
      // (`do_assigned_uid`) is the authoritative value used for the claim,
      // SQLite rows, and the WebSocket tag — see the assignment to
      // `attachment.instance_uid` below.
      decodeAgentToServer(message);

      // Use the DO-assigned UID (do_assigned_uid) for the claim and SQLite.
      // This ensures the claim contains the UID that matches the WS tag,
      // so ctx.getWebSockets(do_assigned_uid) finds the socket on reconnect.
      const doAssignedUid = attachment.do_assigned_uid!;
      const currentGen = ctx.repo.getAgentGeneration(doAssignedUid);
      const nextGen = currentGen + 1;
      const claim: AssignmentClaim = {
        v: 1,
        tenant_id: attachment.tenant_id,
        config_id: attachment.config_id,
        instance_uid: doAssignedUid,
        generation: nextGen,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + ASSIGNMENT_CLAIM_TTL_SECONDS,
      };
      const assignmentToken = await signClaim(claim, ctx.hmacSecret);

      attachment.pending_connection_settings = assignmentToken;

      await ctx.ensureAlarm();

      attachment.is_enrollment = false;
      // Set instance_uid to the DO-assigned UID so that on reconnect (when
      // the agent uses the claim), ctx.getWebSockets(doAssignedUid) finds it.
      attachment.instance_uid = doAssignedUid;
      ws.serializeAttachment(attachment);

      return {
        attachment,
        earlyReturn: false,
        agentIdentification: hexToUint8Array(doAssignedUid),
      };
    } catch (_err) {
      console.error("[enrollment] failed:", _err);
      ws.close(4500, "Enrollment failed");
      return { attachment, earlyReturn: true };
    }
  } else {
    try {
      const agentHello = decodeAgentToServer(message);
      if (
        agentHello.capabilities &&
        agentHello.capabilities & AgentCapabilities.AcceptsOpAMPConnectionSettings
      ) {
        const reconnectGen = ctx.repo.getAgentGeneration(attachment.instance_uid) + 1;
        const claim: AssignmentClaim = {
          v: 1,
          tenant_id: attachment.tenant_id,
          config_id: attachment.config_id,
          instance_uid: attachment.instance_uid,
          generation: reconnectGen,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + ASSIGNMENT_CLAIM_TTL_SECONDS,
        };
        const freshToken = await signClaim(claim, ctx.hmacSecret);
        attachment.pending_connection_settings = freshToken;
      }
    } catch (err) {
      // Spec §4.5: malformed messages SHOULD be answered with error_response,
      // not by closing the WebSocket. We have a valid assignment claim here
      // (it was verified at upgrade time), so the agent can keep the
      // connection and resend a well-formed frame.
      console.error("[reconnect] malformed first frame:", err);
      const errorResponse: ServerToAgent = {
        instance_uid: hexToUint8Array(attachment.instance_uid),
        flags: 0,
        capabilities: SERVER_CAPABILITIES,
        error_response: {
          type: ServerErrorResponseType.BadRequest,
          error_message: err instanceof Error ? err.message : "Malformed message",
        },
      };
      try {
        ws.send(encodeServerToAgent(errorResponse));
      } catch {
        ws.close(4400, "Malformed first message");
      }
      return { attachment, earlyReturn: true };
    }
    ws.serializeAttachment(attachment);
  }

  return { attachment, earlyReturn: false };
}
