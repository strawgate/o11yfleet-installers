import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPostText, apiPut, apiDel, apiFetch, ApiError } from "../client";
import type {
  OverviewResponse as Overview,
  ConfigurationWithStats as Configuration,
  Agent,
  AgentDetail,
  AgentPage,
  AgentDescriptionResponse as AgentDescription,
  ConfigStats,
  Tenant,
} from "@o11yfleet/core/api";

/* ------------------------------------------------------------------ */
/*  Re-export shared types for consumers                              */
/* ------------------------------------------------------------------ */

export type {
  Overview,
  Configuration,
  Agent,
  AgentDetail,
  AgentPage,
  AgentDescription,
  ConfigStats,
  Tenant,
};

/* ------------------------------------------------------------------ */
/*  Local types (no shared schema yet)                                */
/* ------------------------------------------------------------------ */

export interface ConfigVersion {
  id: string;
  version: number;
  config_hash?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface EnrollmentToken {
  id: string;
  token?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface ConfigurationVersionDiff {
  available: boolean;
  reason?: string;
  versions_seen?: number;
  latest?: {
    id: string;
    config_hash: string;
    size_bytes: number;
    created_at: string;
  };
  previous?: {
    id: string;
    config_hash: string;
    size_bytes: number;
    created_at: string;
  };
  diff?: {
    previous_line_count: number;
    latest_line_count: number;
    line_count_delta: number;
    size_bytes_delta: number;
    added_lines: number;
    removed_lines: number;
  };
}

export interface RolloutCohortSummary {
  total_agents: number;
  connected_agents: number;
  healthy_agents: number;
  drifted_agents: number;
  desired_config_hash: string | null;
  status_counts: Record<string, number>;
  current_hash_counts: Array<{ value: string; count: number }>;
}

export interface TeamMember {
  id: string;
  email: string;
  role?: string;
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

export function useOverview() {
  return useQuery({
    queryKey: ["overview"],
    queryFn: () => apiGet<Overview>("/api/v1/overview"),
  });
}

// Appropriate D1 entity metadata list. Use this for explicit picker/token workflows, not
// dashboard counts or fleet-state rollups. Use `useOverview` when config rows need aggregate
// collector metrics.
export function useConfigurations() {
  return useQuery({
    queryKey: ["configurations"],
    queryFn: async () =>
      unwrapList<Configuration>(
        await apiGet<Configuration[] | { configurations: Configuration[] }>(
          "/api/v1/configurations",
        ),
        "configurations",
      ),
    refetchInterval: false,
  });
}

export function useConfiguration(id: string | undefined) {
  return useQuery({
    queryKey: ["configuration", id],
    queryFn: () => apiGet<Configuration>(`/api/v1/configurations/${id}`),
    enabled: !!id,
  });
}

export function useConfigurationYaml(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["configuration", id, "yaml"],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/configurations/${id}/yaml`);
      if (!res.ok) throw new ApiError(`GET yaml: ${res.status}`, res.status);
      return res.text();
    },
    enabled: !!id && enabled,
  });
}

export function useConfigurationAgent(
  configId: string | undefined,
  instanceUid: string | undefined,
) {
  return useQuery({
    queryKey: ["configuration", configId, "agent", instanceUid],
    queryFn: () =>
      apiGet<AgentDetail>(
        `/api/v1/configurations/${configId}/agents/${encodeURIComponent(instanceUid ?? "")}`,
      ),
    enabled: !!configId && !!instanceUid,
  });
}

// Cheap for one active Config DO, very expensive when called once per config. Use only when
// rendering a visible single-config agents table/page, never to calculate summary counts.
export function useConfigurationAgents(
  id: string | undefined,
  params?: {
    limit?: number;
    cursor?: string;
    q?: string;
    status?: string;
    health?: string;
    sort?: string;
    enabled?: boolean;
  },
) {
  const { enabled = true, ...queryParams } = params ?? {};
  return useQuery({
    queryKey: ["configuration", id, "agents", queryParams],
    queryFn: async () => {
      const query = new URLSearchParams();
      if (queryParams.limit) query.set("limit", String(queryParams.limit));
      if (queryParams.cursor) query.set("cursor", queryParams.cursor);
      if (queryParams.q) query.set("q", queryParams.q);
      if (queryParams.status) query.set("status", queryParams.status);
      if (queryParams.health) query.set("health", queryParams.health);
      if (queryParams.sort) query.set("sort", queryParams.sort);
      const data = await apiGet<AgentPage>(
        `/api/v1/configurations/${id}/agents${query.toString() ? `?${query.toString()}` : ""}`,
      );
      if (!Array.isArray(data.agents)) {
        throw new ApiError("GET agents: unexpected response shape", 500);
      }
      const missingIdentity = data.agents.some((agent) => !agent.instance_uid);
      if (missingIdentity) {
        throw new ApiError("GET agents: missing agent identity", 500);
      }
      return data;
    },
    enabled: !!id && enabled,
  });
}

export function useAgentDetail(configId: string | undefined, agentUid: string | undefined) {
  return useQuery({
    queryKey: ["configuration", configId, "agent-detail", agentUid],
    queryFn: async () => {
      return apiGet<AgentDetail>(
        `/api/v1/configurations/${configId}/agents/${encodeURIComponent(agentUid!)}`,
      );
    },
    enabled: !!configId && !!agentUid,
    refetchInterval: 10_000,
  });
}

export function useConfigurationVersions(id: string | undefined) {
  return useQuery({
    queryKey: ["configuration", id, "versions"],
    queryFn: async () =>
      unwrapList<ConfigVersion>(
        await apiGet<ConfigVersion[] | { versions: ConfigVersion[] }>(
          `/api/v1/configurations/${id}/versions`,
        ),
        "versions",
      ),
    enabled: !!id,
  });
}

export function useConfigurationTokens(id: string | undefined) {
  return useQuery({
    queryKey: ["configuration", id, "tokens"],
    queryFn: async () =>
      unwrapList<EnrollmentToken>(
        await apiGet<EnrollmentToken[] | { tokens: EnrollmentToken[] }>(
          `/api/v1/configurations/${id}/enrollment-tokens`,
        ),
        "tokens",
      ),
    enabled: !!id,
  });
}

// Cheap for one active Config DO. Prefer `useOverview` for page-level dashboards because overview
// reads very cheap metrics snapshots and intentionally does not fan out across Config DOs.
export function useConfigurationStats(id: string | undefined) {
  return useQuery({
    queryKey: ["configuration", id, "stats"],
    queryFn: () => apiGet<ConfigStats>(`/api/v1/configurations/${id}/stats`),
    enabled: !!id,
  });
}

export function fetchConfigurationVersionDiff(id: string): Promise<ConfigurationVersionDiff> {
  return apiGet<ConfigurationVersionDiff>(
    `/api/v1/configurations/${id}/version-diff-latest-previous`,
  );
}

export function fetchRolloutCohortSummary(id: string): Promise<RolloutCohortSummary> {
  return apiGet<RolloutCohortSummary>(`/api/v1/configurations/${id}/rollout-cohort-summary`);
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
    queryFn: async () => {
      const data = await apiGet<{ members: TeamMember[] }>("/api/v1/team");
      return data.members;
    },
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
