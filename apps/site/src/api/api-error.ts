// Typed error classes shared by the API client and the rest of the app.
// Lives in its own module (no Vite/window side-effects) so it can be
// imported by node:test unit tests without triggering api-base detection.

import type { ApiErrorResponse } from "@o11yfleet/core/api";

export class ApiError extends Error {
  status: number;
  code?: string;
  field?: string;
  detail?: string;
  constructor(message: string, status: number, body?: ApiErrorResponse) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code;
    this.field = body?.field;
    this.detail = body?.detail;
  }
}

/** Thrown on 401/403 so the app can redirect to login. */
export class AuthError extends ApiError {
  constructor(message = "Session expired") {
    super(message, 401);
    this.name = "AuthError";
  }
}
