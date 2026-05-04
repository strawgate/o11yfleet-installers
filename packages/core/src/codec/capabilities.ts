/**
 * Check if a capability bit is set in a capabilities bitmask.
 *
 * Uses bigint math to avoid JS's int32 truncation. The standard `&` operator
 * silently truncates to int32, so `(capabilities & bit) !== 0` will incorrectly
 * return false when capabilities exceed 31 bits.
 *
 * @example
 * ```ts
 * hasCapability(agent.capabilities, AgentCapabilities.AcceptsRemoteConfig)
 * ```
 */
export function hasCapability(capabilities: number, bit: number): boolean {
  return (BigInt(capabilities) & BigInt(bit)) !== 0n;
}
