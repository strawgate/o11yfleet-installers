import { describe, it, expect } from "vitest";
import { encodeFrame, decodeFrame } from "../src/codec/framing.js";
import { decodeAgentToServer, encodeServerToAgent } from "../src/codec/decoder.js";
import type { AgentToServer, ServerToAgent } from "../src/codec/types.js";
import {
  AgentCapabilities,
  ServerCapabilities,
  ServerToAgentFlags,
  RemoteConfigStatuses,
} from "../src/codec/types.js";

describe("codec/framing", () => {
  it("round-trips a simple AgentToServer message", () => {
    const msg: AgentToServer = {
      instance_uid: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
      sequence_num: 42,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
      flags: 0,
    };

    const buf = encodeFrame(msg);
    expect(buf.byteLength).toBeGreaterThan(4); // At least header

    const decoded = decodeFrame<AgentToServer>(buf);
    expect(decoded.sequence_num).toBe(42);
    expect(decoded.capabilities).toBe(
      AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
    );
    expect(decoded.instance_uid).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded.instance_uid)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it("round-trips a ServerToAgent with remote config", () => {
    const msg: ServerToAgent = {
      instance_uid: new Uint8Array(16),
      flags: ServerToAgentFlags.Unspecified,
      capabilities:
        ServerCapabilities.AcceptsStatus | ServerCapabilities.OffersRemoteConfig,
      remote_config: {
        config: {
          config_map: {
            "collector.yaml": {
              body: new Uint8Array([114, 101, 99, 101, 105, 118, 101, 114, 115]),
              content_type: "text/yaml",
            },
          },
        },
        config_hash: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      },
    };

    const buf = encodeFrame(msg);
    const decoded = decodeFrame<ServerToAgent>(buf);
    expect(decoded.remote_config).toBeDefined();
    expect(decoded.remote_config!.config_hash).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded.remote_config!.config_hash)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    const body = decoded.remote_config!.config.config_map["collector.yaml"].body;
    expect(new TextDecoder().decode(body)).toBe("receivers");
  });

  it("throws on truncated frame", () => {
    const buf = new ArrayBuffer(2);
    expect(() => decodeFrame(buf)).toThrow("Frame too short");
  });

  it("throws on incomplete payload", () => {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setUint32(0, 100, false); // Claims 100 bytes payload
    expect(() => decodeFrame(buf)).toThrow("Incomplete frame");
  });
});

describe("codec/decoder", () => {
  it("decodeAgentToServer round-trips via encodeServerToAgent", () => {
    const agentMsg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 1,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };

    const buf = encodeFrame(agentMsg);
    const decoded = decodeAgentToServer(buf);
    expect(decoded.sequence_num).toBe(1);

    const serverMsg: ServerToAgent = {
      instance_uid: decoded.instance_uid,
      flags: 0,
      capabilities: ServerCapabilities.AcceptsStatus,
    };

    const serverBuf = encodeServerToAgent(serverMsg);
    const serverDecoded = decodeFrame<ServerToAgent>(serverBuf);
    expect(serverDecoded.capabilities).toBe(ServerCapabilities.AcceptsStatus);
  });
});

describe("codec/types", () => {
  it("capability bit flags are correct values", () => {
    expect(AgentCapabilities.ReportsStatus).toBe(0x00000001);
    expect(AgentCapabilities.AcceptsRemoteConfig).toBe(0x00000002);
    expect(AgentCapabilities.ReportsHealth).toBe(0x00000800);
    expect(ServerCapabilities.OffersRemoteConfig).toBe(0x00000002);
  });

  it("RemoteConfigStatuses enum values match proto", () => {
    expect(RemoteConfigStatuses.UNSET).toBe(0);
    expect(RemoteConfigStatuses.APPLIED).toBe(1);
    expect(RemoteConfigStatuses.APPLYING).toBe(2);
    expect(RemoteConfigStatuses.FAILED).toBe(3);
  });
});
