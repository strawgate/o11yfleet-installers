import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, apiDel } from "../client";

/* ------------------------------------------------------------------ */
/*  Response types                                                    */
/* ------------------------------------------------------------------ */

export interface AdminOverview {
  total_tenants?: number;
  total_configurations?: number;
  total_agents?: number;
  connected_agents?: number;
  healthy_agents?: number;
  total_active_tokens?: number;
  total_users?: number;
  tenants?: number;
  agents?: number;
  [key: string]: unknown;
}

export interface AdminTenant {
  id: string;
  name: string;
  plan?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface AdminTenantConfig {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface AdminTenantUser {
  id: string;
  email: string;
  role?: string;
  [key: string]: unknown;
}

export interface AdminPlan {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface AdminHealth {
  status: string;
  [key: string]: unknown;
}

function unwrapList<T>(value: T[] | Record<string, unknown>, key: string): T[] {
  if (Array.isArray(value)) return value;
  const wrapped = value[key];
  if (Array.isArray(wrapped)) return wrapped as T[];
  throw new Error(`unwrapList expected array payload for "${key}": ${JSON.stringify(value)}`);
}

/* ------------------------------------------------------------------ */
/*  Query hooks                                                       */
/* ------------------------------------------------------------------ */

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => apiGet<AdminOverview>("/api/admin/overview"),
  });
}

export function useAdminTenants() {
  return useQuery({
    queryKey: ["admin", "tenants"],
    queryFn: async () =>
      unwrapList<AdminTenant>(
        await apiGet<AdminTenant[] | { tenants: AdminTenant[] }>("/api/admin/tenants"),
        "tenants",
      ),
    refetchInterval: 10_000,
  });
}

export function useAdminTenant(id: string | undefined) {
  return useQuery({
    queryKey: ["admin", "tenant", id],
    queryFn: () => apiGet<AdminTenant>(`/api/admin/tenants/${id}`),
    enabled: !!id,
  });
}

export function useAdminTenantConfigs(id: string | undefined) {
  return useQuery({
    queryKey: ["admin", "tenant", id, "configurations"],
    queryFn: async () =>
      unwrapList<AdminTenantConfig>(
        await apiGet<AdminTenantConfig[] | { configurations: AdminTenantConfig[] }>(
          `/api/admin/tenants/${id}/configurations`,
        ),
        "configurations",
      ),
    enabled: !!id,
  });
}

export function useAdminTenantUsers(id: string | undefined) {
  return useQuery({
    queryKey: ["admin", "tenant", id, "users"],
    queryFn: async () =>
      unwrapList<AdminTenantUser>(
        await apiGet<AdminTenantUser[] | { users: AdminTenantUser[] }>(
          `/api/admin/tenants/${id}/users`,
        ),
        "users",
      ),
    enabled: !!id,
  });
}

export function useAdminPlans() {
  return useQuery({
    queryKey: ["admin", "plans"],
    queryFn: async () =>
      unwrapList<AdminPlan>(
        await apiGet<AdminPlan[] | { plans: AdminPlan[] }>("/api/admin/plans"),
        "plans",
      ),
  });
}

export function useAdminHealth() {
  return useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => apiGet<AdminHealth>("/api/admin/health"),
  });
}

/* ------------------------------------------------------------------ */
/*  Mutation hooks                                                    */
/* ------------------------------------------------------------------ */

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; plan?: string; [key: string]: unknown }) =>
      apiPost<AdminTenant>("/api/admin/tenants", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      void qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });
}

export function useUpdateAdminTenant(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<AdminTenant>) =>
      apiPut<AdminTenant>(`/api/admin/tenants/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      void qc.invalidateQueries({ queryKey: ["admin", "tenant", id] });
    },
  });
}

export function useDeleteAdminTenant(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDel(`/api/admin/tenants/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      void qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });
}

export function useImpersonateTenant(id: string) {
  return useMutation({
    mutationFn: () => apiPost(`/api/admin/tenants/${id}/impersonate`),
  });
}
