/**
 * Unit tests for opamp-session.ts handleFirstMessage function.
 *
 * Tests the enrollment and reconnection flows for OpAMP agents.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleFirstMessage } from "../src/durable-objects/opamp-session.js";
import type { SessionContext } from "../src/durable-objects/opamp-session.js";
import type { AgentStateRepository } from "../src/durable-objects/agent-state-repo-interface.js";
import type { WSAttachment } from "../src/durable-objects/ws-attachment.js";
import { encodeAgentToServerProto } from "@o11yfleet/core/codec";

// Mock WebSocket
class MockWebSocket {
  public attachment: unknown = null;
  public closed = false;
  public closeCode: number | null = null;
  public closeReason: string | null = null;
  public sendThrows = false;

  serializeAttachment(data: unknown) {
    this.attachment = data;
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.closeCode = code ?? null;
    this.closeReason = reason ?? null;
  }

  send(_data: ArrayBuffer | Uint8Array) {
    if (this.sendThrows) {
      throw new Error("WebSocket is closed");
    }
  }
}

// Mock agent hello message builder
function buildHello(instanceUid: Uint8Array, capabilities: number = 0x3f): Uint8Array {
  return encodeAgentToServerProto({
    instance_uid: instanceUid,
    sequence_num: 0,
    capabilities: BigInt(capabilities),
    flags: 0,
  });
}

describe("handleFirstMessage", () => {
  const HMAC_SECRET = "test-secret-key-32-characters!!";
  const TENANT_ID = "test-tenant";
  const CONFIG_ID = "test-config";
  // 16-byte UID, hex-encoded (32 chars). Must be valid hex now that
  // `hexToUint8Array` rejects non-hex characters; the previous placeholder
  // "test-do-assigned-uid-16b" relied on the old silent-coerce-to-zero
  // behavior.
  const DO_ASSIGNED_UID = "00112233445566778899aabbccddeeff";
  const AGENT_REPORTED_UID = new Uint8Array(16);

  // Fill with test data
  for (let i = 0; i < 16; i++) {
    AGENT_REPORTED_UID[i] = i;
  }

  let mockRepo: AgentStateRepository;
  let ensureAlarmMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRepo = {
      getAgentGeneration: vi.fn().mockReturnValue(0),
      saveAgentState: vi.fn(),
      loadAgentState: vi.fn(),
      updateAgentPartial: vi.fn(),
      markDisconnected: vi.fn(),
      getAgentCount: vi.fn().mockReturnValue(0),
      agentExists: vi.fn().mockReturnValue(false),
      saveDoIdentity: vi.fn(),
      loadDoPolicy: vi.fn().mockReturnValue(null),
      saveDoPolicy: vi.fn(),
      loadDesiredConfig: vi.fn().mockReturnValue({
        id: "",
        tenant_id: TENANT_ID,
        config_id: CONFIG_ID,
        content: "",
        bytes: null,
        hash: new Uint8Array(32),
        created_at: 0,
        updated_at: 0,
      }),
      computeMetrics: vi.fn().mockReturnValue({
        total_agents: 0,
        connected_agents: 0,
        healthy_agents: 0,
        desired_config_hash: null,
      }),
      initSchema: vi.fn(),
    } as unknown as AgentStateRepository;

    ensureAlarmMock = vi.fn().mockResolvedValue(undefined);
  });

  describe("enrollment flow (is_enrollment = true)", () => {
    it("creates a claim with DO-assigned UID and stores it in attachment", async () => {
      const ws = new MockWebSocket();
      const attachment: WSAttachment = {
        tenant_id: TENANT_ID,
        config_id: CONFIG_ID,
        instance_uid: "initial",
        connected_at: Date.now(),
        is_enrollment: true,
        is_first_message: true,
        do_assigned_uid: DO_ASSIGNED_UID,
      };
      const message = buildHello(AGENT_REPORTED_UID);

      const ctx: SessionContext = {
        repo: mockRepo,
        hmacSecret: HMAC_SECRET,
        ensureAlarm: ensureAlarmMock,
      };

      const result = await handleFirstMessage(ctx, ws as unknown as WebSocket, attachment, message);

      expect(result.earlyReturn).toBe(false);
      expect(result.agentIdentification).toBeDefined();
      // DO_ASSIGNED_UID is a hex string, converted to bytes
      expect(result.agentIdentification!.length).toBe(Math.ceil(DO_ASSIGNED_UID.length / 2));
      expect(result.attachment.pending_connection_settings).toBeDefined();
      expect(result.attachment.instance_uid).toBe(DO_ASSIGNED_UID);
      expect(result.attachment.is_enrollment).toBe(false);
    });

    it("increments generation from current state", async () => {
      vi.mocked(mockRepo.getAgentGeneration).mockReturnValue(5);

      const ws = new MockWebSocket();
      const attachment: WSAttachment = {
        tenant_id: TENANT_ID,
        config_id: CONFIG_ID,
        instance_uid: "initial",
        connected_at: Date.now(),
        is_enrollment: true,
        is_first_message: true,
        do_assigned_uid: DO_ASSIGNED_UID,
      };
      const message = buildHello(AGENT_REPORTED_UID);

      const ctx: SessionContext = {
        repo: mockRepo,
        hmacSecret: HMAC_SECRET,
        ensureAlarm: ensureAlarmMock,
      };

      const result = await handleFirstMessage(ctx, ws as unknown as WebSocket, attachment, message);

      expect(result.earlyReturn).toBe(false);
      expect(result.agentIdentification).toBeDefined();
    });

    it("schedules alarm after enrollment", async () => {
      const ws = new MockWebSocket();
      const attachment: WSAttachment = {
        tenant_id: TENANT_ID,
        config_id: CONFIG_ID,
        instance_uid: "initial",
        connected_at: Date.now(),
        is_enrollment: true,
        is_first_message: true,
        do_assigned_uid: DO_ASSIGNED_UID,
      };
      const message = buildHello(AGENT_REPORTED_UID);

      const ctx: SessionContext = {
        repo: mockRepo,
        hmacSecret: HMAC_SECRET,
        ensureAlarm: ensureAlarmMock,
      };

      await handleFirstMessage(ctx, ws as unknown as WebSocket, attachment, message);

      expect(ensureAlarmMock).toHaveBeenCalled();
    });

    it("closes WebSocket on malformed message", async () => {
      const ws = new MockWebSocket();
      const attachment: WSAttachment = {
        tenant_id: TENANT_ID,
        config_id: CONFIG_ID,
        instance_uid: "initial",
        connected_at: Date.now(),
        is_enrollment: true,
        is_first_message: true,
        do_assigned_uid: DO_ASSIGNED_UID,
      };
      // Invalid message (not a valid protobuf)
      const message = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

      const ctx: SessionContext = {
        repo: mockRepo,
        hmacSecret: HMAC_SECRET,
        ensureAlarm: ensureAlarmMock,
      };

      const result = await handleFirstMessage(ctx, ws as unknown as WebSocket, attachment, message);

      expect(result.earlyReturn).toBe(true);
      expect(ws.closed).toBe(true);
      expect(ws.closeCode).toBe(4500);
    });
  });

  describe("reconnect flow (is_enrollment = false)", () => {
    it("refreshes connection settings for agents that support OpAMP connection settings", async () => {
      const ws = new MockWebSocket();
      const attachment: WSAttachment = {
        tenant_id: TENANT_ID,
        config_id: CONFIG_ID,
        instance_uid: DO_ASSIGNED_UID,
        connected_at: Date.now(),
        is_enrollment: false,
        is_first_message: false,
        do_assigned_uid: DO_ASSIGNED_UID,
      };
      // Agent with AcceptsOpAMPConnectionSettings capability (0x100)
      const message = buildHello(AGENT_REPORTED_UID, 0x3f | 0x100);

      const ctx: SessionContext = {
        repo: mockRepo,
        hmacSecret: HMAC_SECRET,
        ensureAlarm: ensureAlarmMock,
      };

      const result = await handleFirstMessage(ctx, ws as unknown as WebSocket, attachment, message);

      expect(result.earlyReturn).toBe(false);
      expect(result.attachment.pending_connection_settings).toBeDefined();
    });

    it("does not refresh connection settings for agents without capability", async () => {
      const ws = new MockWebSocket();
      const attachment: WSAttachment = {
        tenant_id: TENANT_ID,
        config_id: CONFIG_ID,
        instance_uid: DO_ASSIGNED_UID,
        connected_at: Date.now(),
        is_enrollment: false,
        is_first_message: false,
        do_assigned_uid: DO_ASSIGNED_UID,
      };
      // Agent without AcceptsOpAMPConnectionSettings (capabilities = 0)
      const message = buildHello(AGENT_REPORTED_UID, 0);

      const ctx: SessionContext = {
        repo: mockRepo,
        hmacSecret: HMAC_SECRET,
        ensureAlarm: ensureAlarmMock,
      };

      const result = await handleFirstMessage(ctx, ws as unknown as WebSocket, attachment, message);

      expect(result.earlyReturn).toBe(false);
      expect(result.attachment.pending_connection_settings).toBeUndefined();
    });

    it("does not schedule alarm on reconnect", async () => {
      const ws = new MockWebSocket();
      const attachment: WSAttachment = {
        tenant_id: TENANT_ID,
        config_id: CONFIG_ID,
        instance_uid: DO_ASSIGNED_UID,
        connected_at: Date.now(),
        is_enrollment: false,
        is_first_message: false,
        do_assigned_uid: DO_ASSIGNED_UID,
      };
      const message = buildHello(AGENT_REPORTED_UID, 0x3f | 0x100);

      const ctx: SessionContext = {
        repo: mockRepo,
        hmacSecret: HMAC_SECRET,
        ensureAlarm: ensureAlarmMock,
      };

      await handleFirstMessage(ctx, ws as unknown as WebSocket, attachment, message);

      expect(ensureAlarmMock).not.toHaveBeenCalled();
    });

    it("returns earlyReturn on malformed message in reconnect", async () => {
      const ws = new MockWebSocket();
      ws.sendThrows = true; // Simulate closed WebSocket
      const attachment: WSAttachment = {
        tenant_id: TENANT_ID,
        config_id: CONFIG_ID,
        instance_uid: DO_ASSIGNED_UID,
        connected_at: Date.now(),
        is_enrollment: false,
        is_first_message: false,
        do_assigned_uid: DO_ASSIGNED_UID,
      };
      // Invalid message
      const message = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

      const ctx: SessionContext = {
        repo: mockRepo,
        hmacSecret: HMAC_SECRET,
        ensureAlarm: ensureAlarmMock,
      };

      const result = await handleFirstMessage(ctx, ws as unknown as WebSocket, attachment, message);

      expect(result.earlyReturn).toBe(true);
      expect(ws.closed).toBe(true);
      expect(ws.closeCode).toBe(4400);
    });
  });
});
