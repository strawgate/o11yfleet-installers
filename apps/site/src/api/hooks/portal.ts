import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPostText, apiPut, apiDel, apiFetch, ApiError } from "../client";
import type {
  OverviewResponse as Overview,
  ConfigurationWithStats as Configuration,
  Agent,
  AgentDetail,
  AgentPage,
  AgentDescriptionResponse as AgentDescription,
  AuditLogListResponse,
  ConfigStats,
  ConfigVersion,
  ConfigurationVersionDiff,
  DisconnectAgentResult,
  DisconnectFleetResult,
  EnrollmentToken,
  PendingDevice,
  PendingToken,
  RestartAgentResult,
  RestartFleetResult,
  RolloutCohortSummary,
  TeamMember,
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
  ConfigVersion,
  ConfigurationVersionDiff,
  EnrollmentToken,
  PendingDevice,
  PendingToken,
  RolloutCohortSummary,
  TeamMember,
  Tenant,
};

function unwrapList<T>(value: T[] | Record<string, unknown>, key: string): T[] {
  if (Array.isArray(value)) return value;
  const wrapped = value[key];
  if (Array.isArray(wrapped)) return wrapped as T[];
  throw new Error(`unwrapList expected array payload for "${key}": ${JSON.stringify(value)}`);
}

/* ------------------------------------------------------------------ */
/*  Query hooks                                                       */
/* ------------------------------------------------------------------ */

export interface AuditLogFilters {
  actor_user_id?: string;
  resource_type?: string;
  resource_id?: string;
  action?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export function useAuditLogs(filters: AuditLogFilters = {}, enabled = true) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return useQuery({
    queryKey: ["audit-logs", filters],
    queryFn: () => apiGet<AuditLogListResponse>(`/api/v1/audit-logs${qs ? `?${qs}` : ""}`),
    enabled,
  });
}

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
    mutationFn: (id: string) => apiDel(`/api/v1/configurations/${encodeURIComponent(id)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["configurations"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

export function useCreateEnrollmentToken(configId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { label?: string }) =>
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
      apiDel(
        `/api/v1/configurations/${encodeURIComponent(configId)}/enrollment-tokens/${encodeURIComponent(tokenId)}`,
      ),
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

export type { RestartFleetResult, DisconnectFleetResult };

export function useRestartConfiguration(configId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<RestartFleetResult>(`/api/v1/configurations/${configId}/restart`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["configuration", configId, "agents"] });
      void qc.invalidateQueries({ queryKey: ["configuration", configId, "stats"] });
    },
  });
}

export function useDisconnectConfiguration(configId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiPost<DisconnectFleetResult>(`/api/v1/configurations/${configId}/disconnect`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["configuration", configId, "agents"] });
      void qc.invalidateQueries({ queryKey: ["configuration", configId, "stats"] });
    },
  });
}

// Agent query keys are nested under the configuration so per-config
// invalidation can be done in one call. There are two reads of a single
// agent — `["configuration", configId, "agent", instanceUid]` (summary,
// line 152) and `["configuration", configId, "agent-detail", agentUid]`
// (detail page, line 204) — both must be invalidated after a per-agent
// command for the UI to reflect the new state.
export function useRestartAgent(configId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instanceUid: string) =>
      apiPost<RestartAgentResult>(
        `/api/v1/configurations/${configId}/agents/${instanceUid}/restart`,
        {},
      ),
    onSuccess: (_data, instanceUid) => {
      void qc.invalidateQueries({ queryKey: ["configuration", configId, "agent", instanceUid] });
      void qc.invalidateQueries({
        queryKey: ["configuration", configId, "agent-detail", instanceUid],
      });
      void qc.invalidateQueries({ queryKey: ["configuration", configId, "agents"] });
    },
  });
}

export function useDisconnectAgent(configId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instanceUid: string) =>
      apiPost<DisconnectAgentResult>(
        `/api/v1/configurations/${configId}/agents/${instanceUid}/disconnect`,
        {},
      ),
    onSuccess: (_data, instanceUid) => {
      void qc.invalidateQueries({ queryKey: ["configuration", configId, "agent", instanceUid] });
      void qc.invalidateQueries({
        queryKey: ["configuration", configId, "agent-detail", instanceUid],
      });
      void qc.invalidateQueries({ queryKey: ["configuration", configId, "agents"] });
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

/* ------------------------------------------------------------------ */
/*  Pending Devices & Tokens                                           */
/* ------------------------------------------------------------------ */

export function usePendingDevices() {
  return useQuery({
    queryKey: ["pending-devices"],
    queryFn: async () => {
      const data = await apiGet<{ devices: PendingDevice[] }>("/api/v1/pending-devices");
      return data.devices ?? [];
    },
  });
}

export function usePendingTokens() {
  return useQuery({
    queryKey: ["pending-tokens"],
    queryFn: async () => {
      const data = await apiGet<{ tokens: PendingToken[] }>("/api/v1/pending-tokens");
      return data.tokens ?? [];
    },
  });
}

export function useSavePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (yaml: string) => {
      // simulate API delay
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500);
      });
      if (!yaml) {
        throw new Error("YAML content is required");
      }
      return { success: true, size: yaml.length };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}

export function useCreatePendingToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label?: string; target_config_id?: string }) =>
      apiPost<{ id: string; token: string; label: string | null; target_config_id: string | null }>(
        "/api/v1/pending-tokens",
        body,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pending-tokens"] });
    },
  });
}

export function useRevokePendingToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) =>
      apiDel(`/api/v1/pending-tokens/${encodeURIComponent(tokenId)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pending-tokens"] });
    },
  });
}

export function useAssignPendingDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceUid, configId }: { deviceUid: string; configId: string }) =>
      apiPost<{ instance_uid: string; target_config_id: string; assigned: boolean }>(
        `/api/v1/pending-devices/${encodeURIComponent(deviceUid)}/assign`,
        { config_id: configId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pending-devices"] });
    },
  });
}
