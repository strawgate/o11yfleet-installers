import { describe, expect, expectTypeOf, it } from "vitest";
import { classifyAuditStatus, type AuditEvent, type AuditScope } from "../src/audit.js";

describe("classifyAuditStatus", () => {
  it("treats 2xx and 3xx as success", () => {
    expect(classifyAuditStatus(200)).toBe("success");
    expect(classifyAuditStatus(201)).toBe("success");
    expect(classifyAuditStatus(204)).toBe("success");
    expect(classifyAuditStatus(302)).toBe("success");
  });

  it("skips 404 and 405 to avoid noise from probing clients", () => {
    expect(classifyAuditStatus(404)).toBe("skip");
    expect(classifyAuditStatus(405)).toBe("skip");
  });

  it("treats other 4xx as failure (auth, validation, conflict)", () => {
    expect(classifyAuditStatus(400)).toBe("failure");
    expect(classifyAuditStatus(401)).toBe("failure");
    expect(classifyAuditStatus(403)).toBe("failure");
    expect(classifyAuditStatus(409)).toBe("failure");
    expect(classifyAuditStatus(422)).toBe("failure");
    expect(classifyAuditStatus(429)).toBe("failure");
  });

  it("treats 5xx as failure", () => {
    expect(classifyAuditStatus(500)).toBe("failure");
    expect(classifyAuditStatus(502)).toBe("failure");
    expect(classifyAuditStatus(503)).toBe("failure");
  });
});

describe("AuditScope", () => {
  it("tenant scope carries the tenant id", () => {
    const scope: AuditScope = { kind: "tenant", tenant_id: "t-1" };
    expect(scope.kind).toBe("tenant");
    if (scope.kind === "tenant") expect(scope.tenant_id).toBe("t-1");
  });

  it("admin scope has no tenant id by construction", () => {
    const scope: AuditScope = { kind: "admin" };
    expect(scope.kind).toBe("admin");
    // Type-level: trying to read `tenant_id` off an admin scope is a
    // compile error — that's the whole point of the discriminated union.
    // @ts-expect-error -- admin scope has no tenant_id
    void scope.tenant_id;
  });

  it("AuditEvent.scope is statically narrow", () => {
    expectTypeOf<AuditEvent["scope"]>().toEqualTypeOf<AuditScope>();
  });
});
