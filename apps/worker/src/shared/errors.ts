// Shared error helpers for o11yfleet worker routes

/**
 * Create a JSON error response with the given message and HTTP status.
 */
export function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/**
 * Route-level API error with HTTP status code.
 * Used instead of throwing AppError directly to keep route handlers simple.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Parse and return the request JSON, throwing ApiError on JSON parse failures.
 * Required-field and schema validation should happen at the call site.
 */
export async function parseJsonBody<T>(request: Request): Promise<T> {
  return request.json<T>().catch(() => {
    throw new ApiError("Invalid JSON in request body", 400);
  });
}
