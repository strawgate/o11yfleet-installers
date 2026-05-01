// Tenant Lifecycle State Machine
// Pure, testable business logic for tenant state transitions

export type TenantStatus = "pending" | "active" | "suspended";

export interface TenantState {
  id: string;
  status: TenantStatus;
  created_at?: string;
  approved_at?: string | null;
  approved_by?: string | null;
}

export interface TenantTransitionResult {
  success: boolean;
  previousStatus: TenantStatus;
  newStatus: TenantStatus;
  error?: string;
}

// Valid transitions:
// pending → active (approve)
// pending → suspended (reject)
// active → suspended (suspend)
// suspended → active (reactivate)
// active → active (no-op, idempotent)
// pending → pending (no-op, idempotent)

const VALID_TRANSITIONS: Record<TenantStatus, TenantStatus[]> = {
  pending: ["active", "suspended", "pending"],
  active: ["suspended", "active"],
  suspended: ["active", "suspended"],
};

export function canTransition(from: TenantStatus, to: TenantStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateTransition(
  currentStatus: TenantStatus,
  desiredStatus: TenantStatus,
): { valid: true } | { valid: false; error: string } {
  if (currentStatus === desiredStatus) {
    return { valid: true }; // Idempotent
  }

  if (!canTransition(currentStatus, desiredStatus)) {
    return {
      valid: false,
      error: `Cannot transition tenant from '${currentStatus}' to '${desiredStatus}'`,
    };
  }

  return { valid: true };
}

export function transition(
  tenant: TenantState,
  desiredStatus: TenantStatus,
  adminId?: string,
): TenantTransitionResult {
  const currentStatus = tenant.status;

  if (currentStatus === desiredStatus) {
    return {
      success: true,
      previousStatus: currentStatus,
      newStatus: desiredStatus,
    };
  }

  const validation = validateTransition(currentStatus, desiredStatus);
  if (!validation.valid) {
    return {
      success: false,
      previousStatus: currentStatus,
      newStatus: currentStatus,
      error: validation.error,
    };
  }

  // Build the update payload
  const now = new Date().toISOString();
  const updates: Partial<TenantState> = {
    status: desiredStatus,
  };

  // Set approval metadata when activating
  if (desiredStatus === "active") {
    updates.approved_at = now;
    updates.approved_by = adminId ?? null;
  }

  return {
    success: true,
    previousStatus: currentStatus,
    newStatus: desiredStatus,
  };
}

export function isActive(tenant: { status?: TenantStatus | null }): boolean {
  return tenant.status === "active";
}

export function isPending(tenant: { status?: TenantStatus | null }): boolean {
  return tenant.status === "pending";
}

export function isSuspended(tenant: { status?: TenantStatus | null }): boolean {
  return tenant.status === "suspended";
}

export function requiresApproval(tenant: { status?: TenantStatus | null }): boolean {
  return tenant.status === "pending";
}

// SQL fragments for D1 queries
export const TENANT_STATUS_CHECK = "status = 'active'";
export const TENANT_NOT_SUSPENDED_CHECK = "status != 'suspended'";
export const TENANT_PENDING_CHECK = "status = 'pending'";
