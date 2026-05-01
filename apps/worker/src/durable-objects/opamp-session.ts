import { AgentCapabilities, decodeAgentToServer, detectCodecFormat } from "@o11yfleet/core/codec";
import { signClaim } from "@o11yfleet/core/auth";
import type { AssignmentClaim } from "@o11yfleet/core/auth";
import { uint8ToHex } from "@o11yfleet/core/hex";
import type { AgentStateRepository } from "./agent-state-repo-interface.js";
import type { WSAttachment } from "./ws-attachment.js";
import { ASSIGNMENT_CLAIM_TTL_SECONDS } from "./constants.js";

export interface SessionContext {
  repo: AgentStateRepository;
  hmacSecret: string;
  ensureAlarm: () => Promise<void>;
}

/**
 * Handle the first message on a new WebSocket — enrollment or reconnection.
 * Detects codec format, processes enrollment/reconnection claims, and
 * updates the attachment accordingly.
 *
 * Returns the updated attachment and whether the message was fully processed
 * (i.e. the caller should NOT continue to processFrame for enrollment failures).
 */
export async function handleFirstMessage(
  ctx: SessionContext,
  ws: WebSocket,
  attachment: WSAttachment,
  message: ArrayBuffer,
): Promise<{ attachment: WSAttachment; earlyReturn: boolean }> {
  attachment.codec_format = detectCodecFormat(message);

  // Complete enrollment on first message (OpAMP spec: client sends first)
  if (attachment.is_enrollment) {
    try {
      const codec = attachment.codec_format;

      // Use the agent's own instance_uid from the message (both codecs)
      const agentMsg = decodeAgentToServer(message, codec!);
      if (agentMsg.instance_uid && agentMsg.instance_uid.byteLength > 0) {
        attachment.instance_uid = uint8ToHex(agentMsg.instance_uid);
      }

      // Generate signed assignment claim for reconnection
      const currentGen = ctx.repo.getAgentGeneration(attachment.instance_uid);
      const nextGen = currentGen + 1;
      const claim: AssignmentClaim = {
        v: 1,
        tenant_id: attachment.tenant_id,
        config_id: attachment.config_id,
        instance_uid: attachment.instance_uid,
        generation: nextGen,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + ASSIGNMENT_CLAIM_TTL_SECONDS,
      };
      const assignmentToken = await signClaim(claim, ctx.hmacSecret);

      // Store assignment token to inject as proper ConnectionSettingsOffers
      // on the first processFrame response (spec: "Registration On First Use").
      attachment.pending_connection_settings = assignmentToken;

      // Send enrollment_complete text frame for JSON clients (backward compatibility
      // with our FakeOpampAgent test harness which expects this custom message).
      // Protobuf clients (real OTel Collectors) get connection_settings in the binary response.
      if (attachment.codec_format === "json") {
        ws.send(
          JSON.stringify({
            type: "enrollment_complete",
            instance_uid: attachment.instance_uid,
            assignment_claim: assignmentToken,
          }),
        );
      }

      await ctx.ensureAlarm();

      attachment.is_enrollment = false;
      ws.serializeAttachment(attachment);
    } catch (_err) {
      console.error("[enrollment] failed:", _err);
      ws.close(4500, "Enrollment failed");
      return { attachment, earlyReturn: true };
    }
    // Fall through to process this first message normally
  } else {
    // Reconnecting agent — check if they want fresh connection_settings
    try {
      const agentHello = decodeAgentToServer(message, attachment.codec_format!);
      if (
        agentHello.capabilities &&
        agentHello.capabilities & AgentCapabilities.AcceptsOpAMPConnectionSettings
      ) {
        // Generate a fresh assignment claim for the reconnecting agent
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
      console.error("[reconnect] malformed first frame:", err);
      ws.close(4400, "Malformed first message");
      return { attachment, earlyReturn: true };
    }
    ws.serializeAttachment(attachment);
  }

  return { attachment, earlyReturn: false };
}
