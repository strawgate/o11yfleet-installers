import { describe, it, expect } from "vitest";
import { withAudit, withAuditCreate } from "../src/routes/v1/index.js";
import type { AuditContext, AuditDescriptor } from "../src/audit/recorder.js";
import { ApiError } from "../src/shared/errors.js";
import { AiApiError } from "../src/ai/guidance.js";

const baseDesc: AuditDescriptor = {
  action: "configuration.create",
  resource_type: "configuration",
  resource_id: null,
};

const baseCreateMeta = {
  action: "configuration.create" as const,
  resource_type: "configuration" as const,
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
        // The real ExecutionContext keeps the request alive until the
        // promise settles; here our fake AUDIT_QUEUE.send pushes the
        // event synchronously before its first await, so the test sees
        // the recorded event without further plumbing.
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
    const out = await withAudit(ctx, { ...baseDesc, resource_id: "cfg_xyz" }, async () => response);
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

describe("withAuditCreate", () => {
  it("uses resource_id from the handler return value on success", async () => {
    const { ctx, recorded } = fakeAuditContext();
    const response = jsonResp({ id: "cfg_abc" }, 201);
    const out = await withAuditCreate(ctx, baseCreateMeta, async () => ({
      response,
      resource_id: "cfg_abc",
    }));
    expect(out).toBe(response);
    expect(recorded[0]?.resource_id).toBe("cfg_abc");
    expect(recorded[0]?.status_code).toBe(201);
    expect(recorded[0]?.status).toBe("success");
  });

  it("records resource_id NULL when handler returns it as null on a failure response", async () => {
    const { ctx, recorded } = fakeAuditContext();
    const response = jsonResp({ error: "tenant not found" }, 404);
    await withAuditCreate(ctx, baseCreateMeta, async () => ({ response, resource_id: null }));
    // 404 is classified as `skip` in classifyAuditStatus — nothing recorded.
    expect(recorded.length).toBe(0);
  });

  it("records failure with resource_id NULL when handler returns 4xx with id null", async () => {
    const { ctx, recorded } = fakeAuditContext();
    const response = jsonResp({ error: "limit reached" }, 429);
    await withAuditCreate(ctx, baseCreateMeta, async () => ({ response, resource_id: null }));
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.resource_id).toBeNull();
    expect(recorded[0]?.status_code).toBe(429);
    expect(recorded[0]?.status).toBe("failure");
  });

  it("records ApiError thrown from handler with status_code and resource_id NULL", async () => {
    const { ctx, recorded } = fakeAuditContext();
    await expect(
      withAuditCreate(ctx, baseCreateMeta, () => {
        throw new ApiError("forbidden", 403);
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(recorded[0]?.resource_id).toBeNull();
    expect(recorded[0]?.status_code).toBe(403);
  });

  it("does not record when audit context is undefined", async () => {
    const response = jsonResp({ id: "cfg_xyz" }, 201);
    const out = await withAuditCreate(undefined, baseCreateMeta, async () => ({
      response,
      resource_id: "cfg_xyz",
    }));
    expect(out).toBe(response);
  });
});
