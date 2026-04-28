import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

// ─── Types ──────────────────────────────────────────────────────

export interface OverviewData {
  total_configurations: number;
  total_agents: number;
  connected_agents: number;
  total_active_tokens: number;
}

export interface Configuration {
  id: string;
  tenant_id: string;
  name: string;
  source_type: string | null;
  target_type: string | null;
  environment: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConfigDetail extends Configuration {
  desired_config_hash: string | null;
}

export interface Agent {
  instance_uid: string;
  config_id: string;
  status: string;
  healthy: boolean;
  hostname: string | null;
  os: string | null;
  agent_version: string | null;
  agent_description: string | null;
  last_seen_at: string;
  effective_config_hash: string | null;
}

export interface ConfigVersion {
  id: string;
  config_hash: string;
  yaml_content: string | null;
  created_at: string;
  message: string | null;
}

export interface EnrollmentToken {
  id: string;
  token_hash: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface NewTokenResponse {
  token: string;
  enrollment_token: EnrollmentToken;
}

export interface ConfigStats {
  total_agents: number;
  connected_agents: number;
  healthy_agents: number;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  created_at: string;
  updated_at: string;
}

export interface AdminOverviewData {
  total_tenants: number;
  total_configurations: number;
  total_active_tokens: number;
  total_users: number;
}

// ─── Portal Queries ─────────────────────────────────────────────

export function useOverview() {
  return useQuery({
    queryKey: ["overview"],
    queryFn: () => api.get<OverviewData>("/api/v1/overview"),
    refetchInterval: 15_000,
  });
}

export function useConfigurations() {
  return useQuery({
    queryKey: ["configurations"],
    queryFn: () =>
      api.get<{ configurations: Configuration[] }>("/api/v1/configurations"),
    select: (d) => d.configurations,
    refetchInterval: 15_000,
  });
}

export function useConfiguration(id: string) {
  return useQuery({
    queryKey: ["configuration", id],
    queryFn: () =>
      api.get<{ configuration: ConfigDetail }>(`/api/v1/configurations/${id}`),
    select: (d) => d.configuration,
  });
}

export function useConfigAgents(configId: string) {
  return useQuery({
    queryKey: ["configuration", configId, "agents"],
    queryFn: () =>
      api.get<{ agents: Agent[] }>(`/api/v1/configurations/${configId}/agents`),
    select: (d) => d.agents,
    refetchInterval: 10_000,
  });
}

export function useConfigVersions(configId: string) {
  return useQuery({
    queryKey: ["configuration", configId, "versions"],
    queryFn: () =>
      api.get<{ versions: ConfigVersion[] }>(
        `/api/v1/configurations/${configId}/versions`,
      ),
    select: (d) => d.versions,
  });
}

export function useConfigStats(configId: string) {
  return useQuery({
    queryKey: ["configuration", configId, "stats"],
    queryFn: () =>
      api.get<ConfigStats>(`/api/v1/configurations/${configId}/stats`),
    refetchInterval: 10_000,
  });
}

export function useEnrollmentTokens(configId: string) {
  return useQuery({
    queryKey: ["configuration", configId, "tokens"],
    queryFn: () =>
      api.get<{ tokens: EnrollmentToken[] }>(
        `/api/v1/configurations/${configId}/enrollment-tokens`,
      ),
    select: (d) => d.tokens,
  });
}

export function useTenant() {
  return useQuery({
    queryKey: ["tenant"],
    queryFn: () => api.get<{ tenant: Tenant }>("/api/v1/tenant"),
    select: (d) => d.tenant,
  });
}

// ─── Portal Mutations ───────────────────────────────────────────

export function useCreateConfiguration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string }) =>
      api.post<{ configuration: Configuration }>("/api/v1/configurations", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["configurations"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

export function useDeleteConfiguration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/v1/configurations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["configurations"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name?: string }) =>
      api.put<{ tenant: Tenant }>("/api/v1/tenant", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant"] }),
  });
}

export function useCreateEnrollmentToken(configId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { label?: string; expires_in_hours?: number }) =>
      api.post<NewTokenResponse>(
        `/api/v1/configurations/${configId}/enrollment-token`,
        data,
      ),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["configuration", configId, "tokens"],
      }),
  });
}

export function useRollout(configId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { config_hash: string }) =>
      api.post(`/api/v1/configurations/${configId}/rollout`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["configuration", configId] });
      qc.invalidateQueries({ queryKey: ["configuration", configId, "agents"] });
    },
  });
}

export function useUploadConfigVersion(configId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (yaml: string) =>
      api.postText<{ version: ConfigVersion }>(
        `/api/v1/configurations/${configId}/versions`,
        yaml,
      ),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["configuration", configId, "versions"],
      }),
  });
}

// ─── Admin Queries ──────────────────────────────────────────────

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.get<AdminOverviewData>("/api/admin/overview"),
    refetchInterval: 15_000,
  });
}

export function useAdminTenants() {
  return useQuery({
    queryKey: ["admin", "tenants"],
    queryFn: () => api.get<{ tenants: Tenant[] }>("/api/admin/tenants"),
    select: (d) => d.tenants,
    refetchInterval: 15_000,
  });
}

export function useAdminTenant(id: string) {
  return useQuery({
    queryKey: ["admin", "tenant", id],
    queryFn: () => api.get<{ tenant: Tenant }>(`/api/admin/tenants/${id}`),
    select: (d) => d.tenant,
  });
}

export function useAdminTenantConfigs(tenantId: string) {
  return useQuery({
    queryKey: ["admin", "tenant", tenantId, "configurations"],
    queryFn: () =>
      api.get<{ configurations: Configuration[] }>(
        `/api/admin/tenants/${tenantId}/configurations`,
      ),
    select: (d) => d.configurations,
  });
}
