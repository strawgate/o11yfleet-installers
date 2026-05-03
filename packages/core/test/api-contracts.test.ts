import { describe, expect, it } from "vitest";
import {
  adminCreateTenantRequestSchema,
  adminDoQueryRequestSchema,
  apiErrorResponseSchema,
  authLoginRequestSchema,
  authLoginResponseSchema,
  createConfigurationRequestSchema,
  createEnrollmentTokenRequestSchema,
  setDesiredConfigRequestSchema,
  validationErrorDetailSchema,
} from "../src/api/index.js";

describe("API contract schemas", () => {
  it("covers every validation detail emitted by the worker validator", () => {
    expect(validationErrorDetailSchema.parse("invalid_type")).toBe("invalid_type");
  });

  it("trims and validates auth login requests", () => {
    expect(
      authLoginRequestSchema.parse({
        email: " admin@example.com ",
        password: "secret",
      }),
    ).toEqual({ email: "admin@example.com", password: "secret" });
  });

  it("rejects unknown mutable request fields", () => {
    const result = adminCreateTenantRequestSchema.safeParse({
      name: "Tenant",
      plan: "growth",
      enabled: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("normalizes admin tenant plan inputs and rejects unknown plans", () => {
    expect(
      adminCreateTenantRequestSchema.parse({
        name: "Tenant",
        plan: " Growth ",
      }).plan,
    ).toBe("growth");

    const result = adminCreateTenantRequestSchema.safeParse({
      name: "Tenant",
      plan: "gold",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("Invalid plan");
    }
  });

  it("keeps tenant-scoped configuration create requests tenant-header scoped", () => {
    expect(
      createConfigurationRequestSchema.safeParse({
        name: "production",
        tenant_id: "tenant-1",
      }).success,
    ).toBe(false);
  });

  it("keeps debug query params JSON-scalar only", () => {
    expect(
      adminDoQueryRequestSchema.safeParse({
        sql: "SELECT ?",
        params: ["value", 1, true, null],
      }).success,
    ).toBe(true);

    expect(
      adminDoQueryRequestSchema.safeParse({
        sql: "SELECT ?",
        params: [{ nested: true }],
      }).success,
    ).toBe(false);
  });

  it("keeps admin Durable Object debug queries read-only", () => {
    expect(adminDoQueryRequestSchema.safeParse({ sql: "SELECT * FROM agents" }).success).toBe(true);
    expect(adminDoQueryRequestSchema.safeParse({ sql: "PRAGMA table_list" }).success).toBe(false);
    expect(adminDoQueryRequestSchema.safeParse({ sql: "DELETE FROM agents" }).success).toBe(false);
    expect(
      adminDoQueryRequestSchema.safeParse({ sql: "SELECT 1; DELETE FROM agents" }).success,
    ).toBe(false);
  });

  it("caps enrollment token expiration at one year", () => {
    expect(createEnrollmentTokenRequestSchema.safeParse({ expires_in_hours: 8760 }).success).toBe(
      true,
    );
    expect(createEnrollmentTokenRequestSchema.safeParse({ expires_in_hours: 8761 }).success).toBe(
      false,
    );
  });

  it("accepts enrollment token with label field", () => {
    expect(createEnrollmentTokenRequestSchema.safeParse({ label: "my-token" }).success).toBe(true);
    expect(createEnrollmentTokenRequestSchema.safeParse({}).success).toBe(true);
    expect(
      createEnrollmentTokenRequestSchema.safeParse({ label: "tok", expires_in_hours: 24 }).success,
    ).toBe(true);
  });

  it("rejects enrollment token with 'name' instead of 'label' (strict mode)", () => {
    const result = createEnrollmentTokenRequestSchema.safeParse({ name: "my-token" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("rejects enrollment token with label exceeding max length", () => {
    expect(createEnrollmentTokenRequestSchema.safeParse({ label: "a".repeat(256) }).success).toBe(
      false,
    );
    expect(createEnrollmentTokenRequestSchema.safeParse({ label: "a".repeat(255) }).success).toBe(
      true,
    );
  });

  it("defines reusable response contracts for callers", () => {
    expect(
      authLoginResponseSchema.parse({
        user: {
          userId: "user-1",
          email: "admin@example.com",
          role: "admin",
          tenantId: null,
        },
      }),
    ).toMatchObject({ user: { id: "user-1", userId: "user-1" } });

    expect(
      apiErrorResponseSchema.parse({
        error: "Invalid request body",
        code: "validation_error",
        field: "name",
        detail: "too_long",
      }),
    ).toMatchObject({ code: "validation_error", field: "name" });
  });

  it("validates internal Durable Object command bodies", () => {
    expect(
      setDesiredConfigRequestSchema.safeParse({ config_hash: "abc123", config_content: null })
        .success,
    ).toBe(true);
    expect(
      setDesiredConfigRequestSchema.safeParse({ config_content: "receivers: {}" }).success,
    ).toBe(false);
  });
});
