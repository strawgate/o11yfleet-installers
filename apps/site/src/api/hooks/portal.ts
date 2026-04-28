import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPostText, apiPut, apiDel, apiFetch, ApiError } from "../client";

/* ------------------------------------------------------------------ */
/*  Response types                                                    */
/* ------------------------------------------------------------------ */

export interface Overview {
  configurations?: Configuration[];
  configs_count?: number;
  agents?: number;
  total_agents?: number;
  active_rollouts?: number | null;
  [key: string]: unknown;
}

export interface Configuration {
  id: string;
  name: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Agent {
  id: string;
  hostname?: string;
  status?: string;
  last_seen?: string;
  [key: string]: unknown;
}

export interface ConfigVersion {
  id: string;
  version: number;
  created_at?: string;
  [key: string]: unknown;
}

export interface EnrollmentToken {
  id: string;
  token?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface ConfigStats {
  agents_connected?: number;
  [key: string]: unknown;
}

export interface Tenant {
  id: string;
  name: string;
  plan?: string;
  [key: string]: unknown;
}

export interface TeamMember {
  id: string;
  email: string;
  role?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  Query hooks                                                       */
/* ------------------------------------------------------------------ */

export function useOverview() {
  return useQuery({
    queryKey: ["overview"],
    queryFn: () => apiGet<Overview>("/api/v1/overview"),
  });
}

export function useConfigurations() {
  return useQuery({
    queryKey: ["configurations"],
    queryFn: () => apiGet<Configuration[]>("/api/v1/configurations"),
    refetchInterval: 10_000,
  });
}

export function useConfiguration(id: string | undefined) {
  return useQuery({
    queryKey: ["configuration", id],
    queryFn: () => apiGet<Configuration>(`/api/v1/configurations/${id}`),
    enabled: !!id,
  });
}

export function useConfigurationYaml(id: string | undefined) {
  return useQuery({
    queryKey: ["configuration", id, "yaml"],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/configurations/${id}/yaml`);
      if (!res.ok) throw new ApiError(`GET yaml: ${res.status}`, res.status);
      return res.text();
    },
    enabled: !!id,
  });
}

export function useConfigurationAgents(id: string | undefined) {
  return useQuery({
    queryKey: ["configuration", id, "agents"],
    queryFn: () => apiGet<Agent[]>(`/api/v1/configurations/${id}/agents`),
    enabled: !!id,
  });
}

export function useConfigurationVersions(id: string | undefined) {
  return useQuery({
    queryKey: ["configuration", id, "versions"],
    queryFn: () => apiGet<ConfigVersion[]>(`/api/v1/configurations/${id}/versions`),
    enabled: !!id,
  });
}

export function useConfigurationTokens(id: string | undefined) {
  return useQuery({
    queryKey: ["configuration", id, "tokens"],
    queryFn: () => apiGet<EnrollmentToken[]>(`/api/v1/configurations/${id}/enrollment-tokens`),
    enabled: !!id,
  });
}

export function useConfigurationStats(id: string | undefined) {
  return useQuery({
    queryKey: ["configuration", id, "stats"],
    queryFn: () => apiGet<ConfigStats>(`/api/v1/configurations/${id}/stats`),
    enabled: !!id,
  });
}

export function useTenant(enabled = true) {
  return useQuery({
    queryKey: ["tenant"],
    queryFn: () => apiGet<Tenant>("/api/v1/tenant"),
    enabled,
  });
}

export function useTeam() {
  return useQuery({
    queryKey: ["team"],
    queryFn: () => apiGet<TeamMember[]>("/api/v1/team"),
  });
}

/* ------------------------------------------------------------------ */
/*  Mutation hooks                                                    */
/* ------------------------------------------------------------------ */

export function useCreateConfiguration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; [key: string]: unknown }) =>
      apiPost<Configuration>("/api/v1/configurations", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["configurations"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

export function useDeleteConfiguration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDel(`/api/v1/configurations/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["configurations"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

export function useCreateEnrollmentToken(configId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { name?: string }) =>
      apiPost<EnrollmentToken>(`/api/v1/configurations/${configId}/enrollment-token`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["configuration", configId, "tokens"] });
    },
  });
}

export function useDeleteEnrollmentToken(configId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) =>
      apiDel(`/api/v1/configurations/${configId}/enrollment-tokens/${tokenId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["configuration", configId, "tokens"] });
    },
  });
}

export function useRolloutConfig(configId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (yaml: string) =>
      apiPostText<Configuration>(`/api/v1/configurations/${configId}/rollout`, yaml),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["configuration", configId] });
      void qc.invalidateQueries({ queryKey: ["configuration", configId, "versions"] });
      void qc.invalidateQueries({ queryKey: ["configuration", configId, "yaml"] });
    },
  });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Tenant>) => apiPut<Tenant>("/api/v1/tenant", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tenant"] });
    },
  });
}

export function useDeleteTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDel("/api/v1/tenant"),
    onSuccess: () => {
      qc.clear();
    },
  });
}
