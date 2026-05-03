import {
  AgentCapabilities,
  decodeAgentToServer,
  encodeServerToAgent,
  ServerErrorResponseType,
} from "@o11yfleet/core/codec";
import type { ServerToAgent } from "@o11yfleet/core/codec";
import { signClaim } from "@o11yfleet/core/auth";
import type { AssignmentClaim } from "@o11yfleet/core/auth";
import { hexToUint8Array, uint8ToHex } from "@o11yfleet/core/hex";
import type { AgentStateRepository } from "./agent-state-repo-interface.js";
import type { WSAttachment } from "./ws-attachment.js";
import { ASSIGNMENT_CLAIM_TTL_SECONDS, SERVER_CAPABILITIES } from "./constants.js";

export interface SessionContext {
  repo: AgentStateRepository;
  hmacSecret: string;
  ensureAlarm: () => Promise<void>;
}

export async function handleFirstMessage(
  ctx: SessionContext,
  ws: WebSocket,
  attachment: WSAttachment,
  message: ArrayBuffer,
): Promise<{ attachment: WSAttachment; earlyReturn: boolean; agentIdentification?: Uint8Array }> {
  if (attachment.is_enrollment) {
    try {
      const agentMsg = decodeAgentToServer(message);

      // Record the agent's self-reported UID (for logging/debugging only).
      // For ALL subsequent operations (claim, SQLite rows, WS tag), we use
      // the DO-assigned UID so that ctx.getWebSockets(uid) works correctly.
      if (agentMsg.instance_uid && agentMsg.instance_uid.byteLength > 0) {
        const agentReportedUid = uint8ToHex(agentMsg.instance_uid);
        // Keep do_assigned_uid as the authoritative UID going forward.
        // The agent will be told to reconnect with this UID via AgentIdentification.
        attachment.instance_uid = agentReportedUid;
      }

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
