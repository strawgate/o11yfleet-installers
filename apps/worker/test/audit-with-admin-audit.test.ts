import { describe, it, expect } from "vitest";
import { withAdminAudit, withAdminAuditCreate } from "../src/routes/admin/index.js";
import type { AuditContext, AuditDescriptor } from "../src/audit/recorder.js";
import { ApiError } from "../src/shared/errors.js";

const baseDesc: AuditDescriptor = {
  action: "admin.tenant.update",
  resource_type: "tenant",
  resource_id: "tenant-123",
};

const baseCreateMeta = {
  action: "admin.tenant.create" as const,
  resource_type: "tenant" as const,
};

function jsonResp(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface RecordedEvent {
  scope_kind: "admin" | "tenant";
  tenant_id: string | null;
  resource_id: string | null;
  status_code: number | null;
  status: "success" | "failure";
  impersonator_user_id: string | null;
}

/** Capture *both* the admin-scope event and the customer-mirror event
 * that recordOnAdminAndCustomer emits, so tests can assert the mirror
 * behavior is preserved. */
function fakeAdminAuditContext(): {
  ctx: AuditContext;
  recorded: RecordedEvent[];
} {
  const recorded: RecordedEvent[] = [];
  const ctx: AuditContext = {
    ctx: {
      waitUntil: (p: Promise<unknown>) => void p,
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
    env: {
      AUDIT_QUEUE: {
        send: async (event: {
          scope: { kind: "admin" } | { kind: "tenant"; tenant_id: string };
          actor: { kind: string; impersonator_user_id?: string | null };
          resource_id: string | null;
          status_code: number | null;
          status: "success" | "failure";
        }) => {
          recorded.push({
            scope_kind: event.scope.kind,
            tenant_id: event.scope.kind === "tenant" ? event.scope.tenant_id : null,
            resource_id: event.resource_id,
            status_code: event.status_code,
            status: event.status,
            impersonator_user_id: event.actor.impersonator_user_id ?? null,
          });
        },
      },
    } as never,
    request: new Request("https://example.test/x"),
    scope: { kind: "admin" },
    actor: {
      kind: "user",
      user_id: "admin-1",
      email: "admin@example.test",
      ip: null,
      user_agent: null,
      impersonator_user_id: null,
    },
  };
  return { ctx, recorded };
}

describe("withAdminAudit", () => {
  it("records a single admin-scope event when no customerTenantId is given", async () => {
    const { ctx, recorded } = fakeAdminAuditContext();
    await withAdminAudit(ctx, baseDesc, async () => jsonResp({ ok: true }, 200));
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.scope_kind).toBe("admin");
    expect(recorded[0]?.tenant_id).toBeNull();
  });

  it("mirrors a customer-tenant event with impersonator_user_id set", async () => {
    const { ctx, recorded } = fakeAdminAuditContext();
    await withAdminAudit(
      ctx,
      baseDesc,
      async () => jsonResp({ ok: true }, 200),
      "customer-tenant-7",
    );
    expect(recorded.length).toBe(2);
    const adminEvent = recorded.find((e) => e.scope_kind === "admin");
    const customerEvent = recorded.find((e) => e.scope_kind === "tenant");
    expect(adminEvent?.impersonator_user_id).toBeNull();
    expect(customerEvent?.tenant_id).toBe("customer-tenant-7");
    // The admin's user_id flows into the customer mirror's
    // impersonator_user_id so customers see "support touched my tenant".
    expect(customerEvent?.impersonator_user_id).toBe("admin-1");
  });

  it("records ApiError status on both admin and customer mirror when handler throws", async () => {
    const { ctx, recorded } = fakeAdminAuditContext();
    await expect(
      withAdminAudit(
        ctx,
        baseDesc,
        () => {
          throw new ApiError("forbidden", 403);
        },
        "customer-tenant-7",
      ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(recorded.length).toBe(2);
    expect(recorded.every((e) => e.status_code === 403)).toBe(true);
    expect(recorded.every((e) => e.status === "failure")).toBe(true);
  });
});

describe("withAdminAuditCreate", () => {
  it("uses resource_id from the handler return on success and mirrors to the customer tenant", async () => {
    const { ctx, recorded } = fakeAdminAuditContext();
    const response = jsonResp({ id: "tenant-new" }, 201);
    const out = await withAdminAuditCreate(
      ctx,
      baseCreateMeta,
      async () => ({ response, resource_id: "tenant-new" }),
      "tenant-new",
    );
    expect(out).toBe(response);
    expect(recorded.length).toBe(2);
    const adminEvent = recorded.find((e) => e.scope_kind === "admin");
    const customerEvent = recorded.find((e) => e.scope_kind === "tenant");
    expect(adminEvent?.resource_id).toBe("tenant-new");
    expect(adminEvent?.status_code).toBe(201);
    expect(customerEvent?.resource_id).toBe("tenant-new");
    expect(customerEvent?.tenant_id).toBe("tenant-new");
    expect(customerEvent?.impersonator_user_id).toBe("admin-1");
  });

  it("records resource_id NULL on a 4xx returned by the handler (no customer mirror requested)", async () => {
    const { ctx, recorded } = fakeAdminAuditContext();
    const response = jsonResp({ error: "invalid plan" }, 400);
    await withAdminAuditCreate(ctx, baseCreateMeta, async () => ({
      response,
      resource_id: null,
    }));
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.scope_kind).toBe("admin");
    expect(recorded[0]?.resource_id).toBeNull();
    expect(recorded[0]?.status_code).toBe(400);
    expect(recorded[0]?.status).toBe("failure");
  });

  it("records ApiError thrown from create handler with resource_id NULL", async () => {
    const { ctx, recorded } = fakeAdminAuditContext();
    await expect(
      withAdminAuditCreate(ctx, baseCreateMeta, () => {
        throw new ApiError("conflict", 409);
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.resource_id).toBeNull();
    expect(recorded[0]?.status_code).toBe(409);
  });

  it("does not record when audit context is undefined", async () => {
    const response = jsonResp({ id: "tenant-new" }, 201);
    const out = await withAdminAuditCreate(undefined, baseCreateMeta, async () => ({
      response,
      resource_id: "tenant-new",
    }));
    expect(out).toBe(response);
  });
});
