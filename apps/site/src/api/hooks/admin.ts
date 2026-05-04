import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  apiDel,
  apiGet,
  apiGetTyped,
  apiPost,
  apiPostTyped,
  apiPutTyped,
  normalizeUser,
  type User,
} from "../client";
import {
  adminApproveTenantResponseSchema,
  adminBulkApproveResponseSchema,
  adminDoQueryResponseSchema,
  adminHealthSchema,
  adminListPlansResponseSchema,
  adminListTenantConfigsResponseSchema,
  adminListTenantUsersResponseSchema,
  adminOverviewSchema,
  adminSettingsSchema,
  adminTenantSchema,
  adminTenantsPageSchema,
  adminUsageSchema,
  type AdminApproveTenantResponse,
  type AdminBulkApproveResponse,
  type AdminDoQueryResponse,
  type AdminHealth,
  type AdminOverview,
  type AdminPlan,
  type AdminSettings,
  type AdminTenant,
  type AdminTenantConfig,
  type AdminTenantsPage,
  type AdminTenantUser,
  type AdminUsage,
  type AdminUsageDaily,
  type AdminUsageLineItem,
  type AdminUsageService,
  type AuthUser,
} from "@o11yfleet/core/api";

/* ------------------------------------------------------------------ */
/*  Re-exports                                                        */
/* ------------------------------------------------------------------ */

// Re-export the canonical types from @o11yfleet/core/api so admin pages
// can keep importing them from this hook module without a churn PR.
export type {
  AdminApproveTenantResponse,
  AdminBulkApproveResponse,
  AdminDoQueryResponse,
  AdminHealth,
  AdminOverview,
  AdminPlan,
  AdminSettings,
  AdminTenant,
  AdminTenantConfig,
  AdminTenantsPage,
  AdminTenantUser,
  AdminUsage,
  AdminUsageDaily,
  AdminUsageLineItem,
  AdminUsageService,
};

/* ------------------------------------------------------------------ */
/*  Query hooks                                                       */
/* ------------------------------------------------------------------ */

export function useAdminOverview() {
  return useQuery<AdminOverview>({
    queryKey: ["admin", "overview"],
    queryFn: () => apiGetTyped(adminOverviewSchema, "/api/admin/overview"),
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

  return useQuery<AdminTenantsPage>({
    queryKey: ["admin", "tenants", params ?? {}],
    queryFn: () => apiGetTyped(adminTenantsPageSchema, path),
    refetchInterval: 10_000,
  });
}

export function useAdminTenants() {
  return useQuery<AdminTenant[]>({
    queryKey: ["admin", "tenants", "legacy"],
    queryFn: async () => {
      const payload = await apiGetTyped(adminTenantsPageSchema, "/api/admin/tenants?limit=500");
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
  return useQuery<AdminTenantConfig[]>({
    queryKey: ["admin", "tenant", id, "configurations"],
    queryFn: async () => {
      const body = await apiGetTyped(
        adminListTenantConfigsResponseSchema,
        `/api/admin/tenants/${id}/configurations`,
      );
      return body.configurations;
    },
    enabled: !!id,
  });
}

export function useAdminTenantUsers(id: string | undefined) {
  return useQuery<AdminTenantUser[]>({
    queryKey: ["admin", "tenant", id, "users"],
    queryFn: async () => {
      const body = await apiGetTyped(
        adminListTenantUsersResponseSchema,
        `/api/admin/tenants/${id}/users`,
      );
      return body.users;
    },
    enabled: !!id,
  });
}

export function useAdminPlans() {
  return useQuery<AdminPlan[]>({
    queryKey: ["admin", "plans"],
    queryFn: async () => {
      const body = await apiGetTyped(adminListPlansResponseSchema, "/api/admin/plans");
      return body.plans;
    },
  });
}

export function useAdminHealth() {
  return useQuery<AdminHealth>({
    queryKey: ["admin", "health"],
    queryFn: () => apiGetTyped(adminHealthSchema, "/api/admin/health"),
  });
}

export function useAdminUsage() {
  return useQuery<AdminUsage>({
    queryKey: ["admin", "usage"],
    queryFn: () => apiGetTyped(adminUsageSchema, "/api/admin/usage"),
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
  return useMutation<
    AdminApproveTenantResponse,
    Error,
    { action: "approve" | "reject"; reason?: string }
  >({
    mutationFn: (body) =>
      apiPostTyped(adminApproveTenantResponseSchema, `/api/admin/tenants/${id}/approve`, body),
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
  return useMutation<AdminDoQueryResponse, Error, { sql: string; params: unknown[] }>({
    mutationFn: (body) =>
      apiPostTyped(
        adminDoQueryResponseSchema,
        `/api/admin/configurations/${configId}/do/query`,
        body,
      ),
  });
}
