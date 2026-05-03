import { describe, it, expect } from "vitest";
import { resolveDescriptor, withAudit } from "../src/routes/v1/index.js";
import type { AuditContext, AuditCreateDescriptor } from "../src/audit/recorder.js";
import { ApiError } from "../src/shared/errors.js";
import { AiApiError } from "../src/ai/guidance.js";

const baseDesc: AuditCreateDescriptor = {
  action: "configuration.create",
  resource_type: "configuration",
  resource_id: null,
  resource_id_from_response: "id",
};

function jsonResp(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface RecordedEvent {
  resource_id: string | null;
  status_code: number | null;
  status: "success" | "failure";
}

/** Capture recorded events without enqueuing onto a real Cloudflare Queue. */
function fakeAuditContext(): {
  ctx: AuditContext;
  recorded: RecordedEvent[];
} {
  const recorded: RecordedEvent[] = [];
  const ctx: AuditContext = {
    ctx: {
      waitUntil: (p: Promise<unknown>) => {
        // Drive any pending queue.send so the test sees the event before
        // assertion. The real ExecutionContext keeps the request alive
        // until the promise settles; here we just await synchronously
        // via a microtask drain.
        void p;
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
    env: {
      AUDIT_QUEUE: {
        send: async (event: RecordedEvent) => {
          recorded.push({
            resource_id: event.resource_id,
            status_code: event.status_code,
            status: event.status,
          });
        },
      },
    } as never,
    request: new Request("https://example.test/x"),
    scope: { kind: "tenant", tenant_id: "t1" },
    actor: {
      kind: "user",
      user_id: "u1",
      email: null,
      ip: null,
      user_agent: null,
      impersonator_user_id: null,
    },
  };
  return { ctx, recorded };
}

describe("resolveDescriptor", () => {
  it("substitutes resource_id from response body field on 2xx", async () => {
    const resp = jsonResp({ id: "cfg_123" }, 201);
    const out = await resolveDescriptor(baseDesc, resp);
    expect(out.resource_id).toBe("cfg_123");
  });

  it("keeps original resource_id when status is not 2xx", async () => {
    const resp = jsonResp({ id: "ignored" }, 400);
    const out = await resolveDescriptor({ ...baseDesc, resource_id: "fallback" }, resp);
    expect(out.resource_id).toBe("fallback");
  });

  it("falls back to literal resource_id when body is non-JSON", async () => {
    const resp = new Response("not json", { status: 201 });
    const out = await resolveDescriptor({ ...baseDesc, resource_id: "fallback" }, resp);
    expect(out.resource_id).toBe("fallback");
  });

  it("falls back when the named field is missing", async () => {
    const resp = jsonResp({ other: "x" }, 201);
    const out = await resolveDescriptor({ ...baseDesc, resource_id: null }, resp);
    expect(out.resource_id).toBeNull();
  });

  it("falls back when the named field is not a non-empty string", async () => {
    const resp = jsonResp({ id: "" }, 201);
    const out = await resolveDescriptor({ ...baseDesc, resource_id: "fallback" }, resp);
    expect(out.resource_id).toBe("fallback");
  });

  it("does not consume the response body", async () => {
    const resp = jsonResp({ id: "cfg_abc" }, 201);
    await resolveDescriptor(baseDesc, resp);
    // Original response body must remain readable for the route caller.
    const body = (await resp.json()) as { id: string };
    expect(body.id).toBe("cfg_abc");
  });

  it("ignores extraction when descriptor has no resource_id_from_response", async () => {
    const resp = jsonResp({ id: "ignored" }, 201);
    const desc = {
      action: "configuration.create" as const,
      resource_type: "configuration" as const,
      resource_id: "literal",
    };
    const out = await resolveDescriptor(desc, resp);
    expect(out.resource_id).toBe("literal");
  });
});

describe("withAudit", () => {
  it("records ApiError status when handler throws", async () => {
    const { ctx, recorded } = fakeAuditContext();
    await expect(
      withAudit(ctx, baseDesc, () => {
        throw new ApiError("forbidden", 403);
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.status_code).toBe(403);
    expect(recorded[0]?.status).toBe("failure");
  });

  it("records AiApiError status when handler throws", async () => {
    const { ctx, recorded } = fakeAuditContext();
    await expect(
      withAudit(ctx, baseDesc, () => {
        throw new AiApiError("ai down", 503);
      }),
    ).rejects.toBeInstanceOf(AiApiError);
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.status_code).toBe(503);
    expect(recorded[0]?.status).toBe("failure");
  });

  it("records 500 when handler throws non-Api error", async () => {
    const { ctx, recorded } = fakeAuditContext();
    await expect(
      withAudit(ctx, baseDesc, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.status_code).toBe(500);
    expect(recorded[0]?.status).toBe("failure");
  });

  it("records the response and returns it on success", async () => {
    const { ctx, recorded } = fakeAuditContext();
    const response = jsonResp({ id: "cfg_xyz" }, 201);
    const out = await withAudit(ctx, baseDesc, async () => response);
    expect(out).toBe(response);
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.resource_id).toBe("cfg_xyz");
    expect(recorded[0]?.status_code).toBe(201);
    expect(recorded[0]?.status).toBe("success");
  });

  it("does not record when audit context is undefined", async () => {
    const response = jsonResp({ id: "cfg_xyz" }, 201);
    const out = await withAudit(undefined, baseDesc, async () => response);
    expect(out).toBe(response);
  });
});
