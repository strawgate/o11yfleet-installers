// Compile-time exhaustiveness check — place in default/else branches.
// If a new variant is added to a union/enum without handling it,
// TypeScript will report a type error here at build time.

export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${String(value)}`);
}
