import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  apiGet,
  apiGetTyped,
  apiPost,
  apiPostTyped,
  apiPutTyped,
  apiDel,
  normalizeUser,
  type User,
} from "../client";
import {
  adminBulkApproveResponseSchema,
  adminSettingsSchema,
  adminTenantSchema,
  type AdminBulkApproveResponse,
  type AdminSettings,
  type AdminTenant,
  type AuthUser,
} from "@o11yfleet/core/api";
import type { AdminHealthPayload } from "../../pages/admin/support-model";

/* ------------------------------------------------------------------ */
/*  Response types                                                    */
/* ------------------------------------------------------------------ */

export type { AdminTenant };

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

export type AdminHealth = AdminHealthPayload;

export interface AdminUsageLineItem {
  label: string;
  quantity: number;
  unit: string;
  included: number;
  billable: number;
  unit_price_usd: number;
  estimated_spend_usd: number;
}

export interface AdminUsageDaily {
  date: string;
  estimated_spend_usd: number;
  units: Record<string, number>;
}

export interface AdminUsageService {
  id: string;
  name: string;
  status: "ready" | "not_configured" | "error";
  source: string;
  daily: AdminUsageDaily[];
  line_items: AdminUsageLineItem[];
  month_to_date_estimated_spend_usd: number;
  projected_month_estimated_spend_usd: number;
  notes: string[];
  error?: string;
}

export interface AdminUsage {
  configured: boolean;
  currency: "USD";
  generated_at: string;
  window: {
    start_date: string;
    end_date: string;
    days_elapsed: number;
    days_in_month: number;
  };
  pricing: {
    source: string;
    notes: string[];
  };
  required_env: string[];
  services: AdminUsageService[];
  month_to_date_estimated_spend_usd: number;
  projected_month_estimated_spend_usd: number;
}

export interface AdminTenantsPagination {
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
}

export interface AdminTenantsFilters {
  q: string;
  plan: string;
  status: string | null;
  sort: string;
}

export interface AdminTenantsPage {
  tenants: AdminTenant[];
  pagination: AdminTenantsPagination;
  filters: AdminTenantsFilters;
  status_counts: Record<string, number>;
}

export interface AdminDoQueryResponse {
  rows: Array<Record<string, unknown>>;
  row_count: number;
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

export function useAdminTenantsPage(params?: {
  q?: string;
  plan?: string;
  status?: string | null;
  sort?: string;
  page?: number;
  limit?: number;
}) {
  const query = new URLSearchParams();
  if (params?.q) query.set("q", params.q);
  if (params?.plan) query.set("plan", params.plan);
  if (params?.status) query.set("status", params.status);
  if (params?.sort) query.set("sort", params.sort);
  if (params?.page) query.set("page", String(params.page));
  if (params?.limit) query.set("limit", String(params.limit));
  const search = query.toString();
  const path = search.length > 0 ? `/api/admin/tenants?${search}` : "/api/admin/tenants";

  return useQuery({
    queryKey: ["admin", "tenants", params ?? {}],
    queryFn: async () => apiGet<AdminTenantsPage>(path),
    refetchInterval: 10_000,
  });
}

export function useAdminTenants() {
  return useQuery({
    queryKey: ["admin", "tenants", "legacy"],
    queryFn: async () => {
      const payload = await apiGet<AdminTenantsPage>("/api/admin/tenants?limit=500");
      return payload.tenants;
    },
    refetchInterval: 10_000,
  });
}

export function useAdminTenant(id: string | undefined) {
  return useQuery({
    queryKey: ["admin", "tenant", id],
    queryFn: () => apiGetTyped(adminTenantSchema, `/api/admin/tenants/${id}`),
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

export function useAdminUsage() {
  return useQuery({
    queryKey: ["admin", "usage"],
    queryFn: () => apiGet<AdminUsage>("/api/admin/usage"),
    refetchInterval: 300_000,
  });
}

export function useAdminDoTables(configId: string) {
  return useQuery({
    queryKey: ["admin", "configurations", configId, "do", "tables"],
    queryFn: async () => {
      const body = await apiGet<{ tables: string[] }>(
        `/api/admin/configurations/${configId}/do/tables`,
      );
      return body.tables;
    },
    enabled: false,
  });
}

/* ------------------------------------------------------------------ */
/*  Mutation hooks                                                    */
/* ------------------------------------------------------------------ */

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; plan?: string; [key: string]: unknown }) =>
      apiPostTyped(adminTenantSchema, "/api/admin/tenants", body),
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
      apiPutTyped(adminTenantSchema, `/api/admin/tenants/${id}`, body),
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
    mutationFn: async (): Promise<{ user: User }> => {
      const response = await apiPost<{ user: AuthUser }>(`/api/admin/tenants/${id}/impersonate`);
      return { user: normalizeUser(response.user) };
    },
  });
}

export function useApproveTenant(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: "approve" | "reject"; reason?: string }) =>
      apiPost<{ success: boolean; status: string; tenantId: string }>(
        `/api/admin/tenants/${id}/approve`,
        body,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      void qc.invalidateQueries({ queryKey: ["admin", "tenant", id] });
    },
  });
}

export function useBulkApproveTenants() {
  const qc = useQueryClient();
  return useMutation<AdminBulkApproveResponse, Error, { tenant_ids: string[] }>({
    mutationFn: (body) =>
      apiPostTyped(adminBulkApproveResponseSchema, "/api/admin/bulk-approve", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      void qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });
}

export function useAdminSettings() {
  return useQuery<AdminSettings>({
    queryKey: ["admin", "settings"],
    queryFn: () => apiGetTyped(adminSettingsSchema, "/api/admin/settings"),
  });
}

export function useAdminDoQuery(configId: string) {
  return useMutation({
    mutationFn: (body: { sql: string; params: unknown[] }) =>
      apiPost<AdminDoQueryResponse>(`/api/admin/configurations/${configId}/do/query`, body),
  });
}
