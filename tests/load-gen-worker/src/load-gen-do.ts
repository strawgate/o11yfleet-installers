// LoadGenDO — STUB: needs protobuf rewrite before use
//
// This DO managed outbound WebSocket connections for cloud-scale load generation.
// The implementation was removed because it used JSON-encoded OpAMP frames, which
// are incompatible with the protobuf-only server (changed in #399).
//
// To restore cloud-scale load generation:
//   1. Import encodeAgentToServerProto from @o11yfleet/core (or inline the protobuf
//      encoder — the DO runs in a Cloudflare Worker isolate with no npm resolution).
//   2. Replace encodeFrame() with encodeAgentToServerProto().
//   3. Replace the handleMessage() JSON parser with decodeServerToAgentProto().
//   4. Wire up the enrollment flow to extract the Bearer claim from
//      ConnectionSettingsOffers.opamp.headers, matching FakeOpampAgent.connectAndEnroll().
//
// For local load testing up to ~30K agents, use `just load-test-30k` instead.

export class LoadGenDO {
  constructor(_ctx: DurableObjectState, _env: Record<string, unknown>) {}

  async fetch(_request: Request): Promise<Response> {
    return new Response(
      "LoadGenDO is a stub — see load-gen-worker/src/load-gen-do.ts for rewrite instructions.",
      { status: 501 },
    );
  }
}
