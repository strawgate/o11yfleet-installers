import { describe, it, expect } from "vitest";
import {
  AppError,
  AuthError,
  ProtocolError,
  RateLimitError,
  StorageError,
  NotFoundError,
  errorResponse,
  WS_CLOSE_CODES,
} from "../src/errors";

describe("AppError", () => {
  it("creates error with code and statusCode", () => {
    const err = new AppError("test message", "TEST_ERROR", 500);
    expect(err.message).toBe("test message");
    expect(err.code).toBe("TEST_ERROR");
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe("AppError");
  });

  it("toJSON returns error shape without requestId", () => {
    const err = new AppError("oops", "BAD_REQUEST", 400);
    expect(err.toJSON()).toEqual({ error: "oops", code: "BAD_REQUEST" });
  });

  it("toJSON includes request_id when provided", () => {
    const err = new AppError("oops", "BAD_REQUEST", 400, { requestId: "req-123" });
    expect(err.toJSON()).toEqual({ error: "oops", code: "BAD_REQUEST", request_id: "req-123" });
  });
});

describe("AuthError", () => {
  it("sets code AUTH_ERROR and status 401", () => {
    const err = new AuthError("Invalid token");
    expect(err.code).toBe("AUTH_ERROR");
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe("AuthError");
  });
});

describe("ProtocolError", () => {
  it("sets code PROTOCOL_ERROR and status 400", () => {
    const err = new ProtocolError("Bad frame");
    expect(err.code).toBe("PROTOCOL_ERROR");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ProtocolError");
  });
});

describe("RateLimitError", () => {
  it("sets code RATE_LIMIT and status 429", () => {
    const err = new RateLimitError("Too many requests");
    expect(err.code).toBe("RATE_LIMIT");
    expect(err.statusCode).toBe(429);
    expect(err.name).toBe("RateLimitError");
  });
});

describe("StorageError", () => {
  it("sets code STORAGE_ERROR and status 500", () => {
    const err = new StorageError("R2 unavailable");
    expect(err.code).toBe("STORAGE_ERROR");
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe("StorageError");
  });
});

describe("NotFoundError", () => {
  it("sets code NOT_FOUND and status 404", () => {
    const err = new NotFoundError("Tenant not found");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe("NotFoundError");
  });
});

describe("errorResponse", () => {
  it("returns Response with correct status and JSON body", async () => {
    const err = new NotFoundError("Config not found");
    const response = errorResponse(err);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: "Config not found", code: "NOT_FOUND" });
  });

  it("preserves request_id in response body", async () => {
    const err = new AuthError("Invalid token", "req-abc");
    const response = errorResponse(err);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Invalid token", code: "AUTH_ERROR", request_id: "req-abc" });
  });
});

describe("WS_CLOSE_CODES", () => {
  it("has expected close codes", () => {
    expect(WS_CLOSE_CODES.RATE_LIMIT).toBe(4029);
    expect(WS_CLOSE_CODES.PROTOCOL_ERROR).toBe(4000);
    expect(WS_CLOSE_CODES.AUTH_ERROR).toBe(4001);
    expect(WS_CLOSE_CODES.INTERNAL_ERROR).toBe(4500);
  });
});
