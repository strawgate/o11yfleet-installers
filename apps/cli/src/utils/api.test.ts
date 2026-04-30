import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRequest, ApiError } from "./api.js";
import * as configModule from "./config.js";

describe("apiRequest", () => {
  function mockResponse(response: Partial<Response>): Response {
    return response as Response;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(configModule, "getApiUrl").mockResolvedValue("http://localhost:8787");
    vi.spyOn(configModule, "getSession").mockResolvedValue({ cookie: undefined, token: undefined });
    vi.spyOn(configModule, "getTenantId").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns data on successful JSON response", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: vi.fn().mockResolvedValue({ id: "123", name: "Test" }),
      }),
    );

    const result = await apiRequest("/api/test");

    expect(result.data).toEqual({ id: "123", name: "Test" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
  });

  it("includes auth headers when token is available", async () => {
    vi.spyOn(configModule, "getSession").mockResolvedValueOnce({
      cookie: undefined,
      token: "test-token",
    });

    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: vi.fn().mockResolvedValue({}),
      }),
    );

    await apiRequest("/api/test");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8787/api/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("includes cookie when session cookie is available", async () => {
    vi.spyOn(configModule, "getSession").mockResolvedValueOnce({
      cookie: "session-abc",
      token: undefined,
    });

    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: vi.fn().mockResolvedValue({}),
      }),
    );

    await apiRequest("/api/test");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8787/api/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: "fp_session=session-abc",
        }),
      }),
    );
  });

  it("uses API key env var when set", async () => {
    vi.stubEnv("O11YFLEET_API_KEY", "env-api-key");

    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: vi.fn().mockResolvedValue({}),
      }),
    );

    await apiRequest("/api/test");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8787/api/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer env-api-key",
        }),
      }),
    );

    vi.unstubAllEnvs();
  });

  it("includes X-Tenant-Id when tenantId is available", async () => {
    vi.spyOn(configModule, "getTenantId").mockResolvedValueOnce("tenant-123");

    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: vi.fn().mockResolvedValue({}),
      }),
    );

    await apiRequest("/api/test");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8787/api/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Tenant-Id": "tenant-123",
        }),
      }),
    );
  });

  it("returns error on HTTP error responses", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: { get: () => "application/json" },
        json: vi.fn().mockResolvedValue({ error: "Resource not found" }),
      }),
    );

    const result = await apiRequest("/api/test");

    expect(result.error).toBe("Resource not found");
    expect(result.status).toBe(404);
  });

  it("handles network errors gracefully", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("Connection refused"));

    const result = await apiRequest("/api/test");

    expect(result.error).toBe("Connection refused");
    expect(result.status).toBe(0);
  });

  it("returns error text when response is not JSON", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: { get: () => "text/plain" },
        text: vi.fn().mockResolvedValue("Server error occurred"),
      }),
    );

    const result = await apiRequest("/api/test");

    expect(result.error).toBe("Server error occurred");
    expect(result.status).toBe(500);
  });

  it("handles JSON parse errors", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({
        ok: false,
        status: 400,
        headers: { get: () => "application/json" },
        json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
        text: vi.fn().mockResolvedValue("Raw error text"),
      }),
    );

    const result = await apiRequest("/api/test");

    expect(result.error).toBe("Raw error text");
    expect(result.status).toBe(400);
  });
});

describe("ApiError", () => {
  it("extends Error and has correct properties", () => {
    const error = new ApiError("Not found", 404, "Resource missing");
    expect(error.message).toBe("Not found");
    expect(error.status).toBe(404);
    expect(error.details).toBe("Resource missing");
    expect(error.name).toBe("ApiError");
  });
});
