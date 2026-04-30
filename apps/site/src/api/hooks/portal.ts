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
  connected_agents?: number;
  healthy_agents?: number;
  active_rollouts?: number | null;
  [key: string]: unknown;
}

export interface Configuration {
  id: string;
  name: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  stats?: {
    total?: number;
    connected?: number;
    healthy?: number;
  };
  [key: string]: unknown;
}

export interface Agent {
  id?: string;
  instance_uid?: string;
  hostname?: string;
  status?: string;
  last_seen?: string;
  healthy?: boolean | number;
  current_config_hash?: string | null;
  desired_config_hash?: string | null;
  last_seen_at?: string | number;
  connected_at?: string | number;
  last_error?: string | null;
  agent_description?: string;
  capabilities?: number | string | null;
  [key: string]: unknown;
}
export interface AgentPage {
  agents: Agent[];
  pagination: {
    limit: number;
    next_cursor: string | null;
    has_more: boolean;
    sort: "last_seen_desc" | "last_seen_asc" | "instance_uid_asc";
  };
  filters: { q?: string; status?: string; health?: "healthy" | "unhealthy" | "unknown" };
}

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

export interface ConfigStats {
  total_agents?: number;
  agents_connected?: number;
  connected_agents?: number;
  healthy_agents?: number;
  drifted_agents?: number;
  status_counts?: Record<string, number>;
  current_hash_counts?: Array<{ value: string; count: number }>;
  desired_config_hash?: string | null;
  active_websockets?: number;
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
      apiGet<Agent>(
        `/api/v1/configurations/${configId}/agents/${encodeURIComponent(instanceUid ?? "")}`,
      ),
    enabled: !!configId && !!instanceUid,
  });
}

export function useConfigurationAgents(
  id: string | undefined,
  params?: {
    limit?: number;
    cursor?: string;
    q?: string;
    status?: string;
    health?: string;
    sort?: string;
  },
) {
  return useQuery({
    queryKey: ["configuration", id, "agents", params],
    queryFn: async () => {
      const query = new URLSearchParams();
      if (params?.limit) query.set("limit", String(params.limit));
      if (params?.cursor) query.set("cursor", params.cursor);
      if (params?.q) query.set("q", params.q);
      if (params?.status) query.set("status", params.status);
      if (params?.health) query.set("health", params.health);
      if (params?.sort) query.set("sort", params.sort);
      const data = await apiGet<AgentPage>(
        `/api/v1/configurations/${id}/agents${query.toString() ? `?${query.toString()}` : ""}`,
      );
      if (!Array.isArray(data.agents)) {
        throw new ApiError("GET agents: unexpected response shape", 500);
      }
      const missingIdentity = data.agents.some((agent) => !agent.instance_uid && !agent.id);
      if (missingIdentity) {
        throw new ApiError("GET agents: missing agent identity", 500);
      }
      return data;
    },
    enabled: !!id,
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
