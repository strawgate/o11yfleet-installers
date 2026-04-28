// Typed error classes for o11yfleet

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "AppError";
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.requestId && { request_id: this.requestId }),
    };
  }
}

export class AuthError extends AppError {
  constructor(message: string, requestId?: string) {
    super(message, "AUTH_ERROR", 401, requestId);
    this.name = "AuthError";
  }
}

export class ProtocolError extends AppError {
  constructor(message: string, requestId?: string) {
    super(message, "PROTOCOL_ERROR", 400, requestId);
    this.name = "ProtocolError";
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, requestId?: string) {
    super(message, "RATE_LIMIT", 429, requestId);
    this.name = "RateLimitError";
  }
}

export class StorageError extends AppError {
  constructor(message: string, requestId?: string) {
    super(message, "STORAGE_ERROR", 500, requestId);
    this.name = "StorageError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, requestId?: string) {
    super(message, "NOT_FOUND", 404, requestId);
    this.name = "NotFoundError";
  }
}

/** Map an AppError to an HTTP Response */
export function errorResponse(err: AppError): Response {
  return Response.json(err.toJSON(), { status: err.statusCode });
}

/** WebSocket close codes for protocol/rate limit errors */
export const WS_CLOSE_CODES = {
  RATE_LIMIT: 4029,
  PROTOCOL_ERROR: 4000,
  AUTH_ERROR: 4001,
  INTERNAL_ERROR: 4500,
} as const;
