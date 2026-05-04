// Unit tests for Tenant Lifecycle State Machine
// These tests demonstrate the testable, pure business logic

import { describe, it, expect } from "vitest";
import {
  canTransition,
  validateTransition,
  transition,
  isActive,
  isPending,
  isSuspended,
  requiresApproval,
  type TenantState,
} from "../src/shared/tenant-lifecycle.js";

describe("Tenant Lifecycle State Machine", () => {
  describe("canTransition", () => {
    it("allows pending -> active", () => {
      expect(canTransition("pending", "active")).toBe(true);
    });

    it("allows pending -> suspended", () => {
      expect(canTransition("pending", "suspended")).toBe(true);
    });

    it("allows active -> suspended", () => {
      expect(canTransition("active", "suspended")).toBe(true);
    });

    it("allows suspended -> active (reactivate)", () => {
      expect(canTransition("suspended", "active")).toBe(true);
    });

    it("allows self-transitions (idempotent)", () => {
      expect(canTransition("pending", "pending")).toBe(true);
      expect(canTransition("active", "active")).toBe(true);
      expect(canTransition("suspended", "suspended")).toBe(true);
    });

    it("disallows invalid transitions", () => {
      // Can't go backwards
      expect(canTransition("active", "pending")).toBe(false);
      expect(canTransition("suspended", "pending")).toBe(false);
    });
  });

  describe("validateTransition", () => {
    it("returns valid for allowed transitions", () => {
      expect(validateTransition("pending", "active")).toEqual({ valid: true });
      expect(validateTransition("active", "suspended")).toEqual({ valid: true });
    });

    it("returns valid for idempotent transitions", () => {
      expect(validateTransition("pending", "pending")).toEqual({ valid: true });
      expect(validateTransition("active", "active")).toEqual({ valid: true });
    });

    it("returns error for invalid transitions", () => {
      const result = validateTransition("active", "pending");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Cannot transition");
      }
    });
  });

  describe("transition", () => {
    it("returns success for valid transitions", () => {
      const tenant: TenantState = { id: "test-1", status: "pending" };
      const result = transition(tenant, "active", "admin-1");

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("pending");
      expect(result.newStatus).toBe("active");
    });

    it("returns failure for invalid transitions", () => {
      const tenant: TenantState = { id: "test-1", status: "active" };
      const result = transition(tenant, "pending");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns success for idempotent transitions", () => {
      const tenant: TenantState = { id: "test-1", status: "active" };
      const result = transition(tenant, "active");

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("active");
      expect(result.newStatus).toBe("active");
    });
  });

  describe("helper predicates", () => {
    it("isActive", () => {
      expect(isActive({ status: "active" })).toBe(true);
      expect(isActive({ status: "pending" })).toBe(false);
      expect(isActive({ status: "suspended" })).toBe(false);
      expect(isActive({})).toBe(false);
    });

    it("isPending", () => {
      expect(isPending({ status: "pending" })).toBe(true);
      expect(isPending({ status: "active" })).toBe(false);
    });

    it("isSuspended", () => {
      expect(isSuspended({ status: "suspended" })).toBe(true);
      expect(isSuspended({ status: "active" })).toBe(false);
    });

    it("requiresApproval", () => {
      expect(requiresApproval({ status: "pending" })).toBe(true);
      expect(requiresApproval({ status: "active" })).toBe(false);
      expect(requiresApproval({ status: "suspended" })).toBe(false);
    });
  });
});

describe("Mock Email Service", () => {
  it("can be used for testing email sending", async () => {
    // Import the mock from the email service
    const { MockEmailService } = await import("../src/shared/email-mock.js");

    const mockService = new MockEmailService();

    // Should be configured by default
    expect(mockService.isConfigured()).toBe(true);

    // Send an email
    const result = await mockService.send({
      to: "test@example.com",
      subject: "Test Email",
      html: "<p>Hello</p>",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();

    // Verify email was tracked
    const sent = mockService.getSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("test@example.com");

    // Can test failure scenarios
    mockService.setShouldFail(true, "Test failure");
    const failedResult = await mockService.send({
      to: "fail@example.com",
      subject: "Fail",
      html: "",
    });
    expect(failedResult.success).toBe(false);
    expect(failedResult.error).toBe("Test failure");
  });
});
