// Kysely schema describing every D1 table in `packages/db/migrations/`.
//
// This file is the SINGLE SOURCE OF TYPE TRUTH for D1 queries. The .sql
// migration files remain authoritative for runtime DDL — Kysely is purely
// a type-safe builder; it does not own the schema. When you add a column
// in a migration, mirror the column here so the type checker can see it.
//
// Conventions:
// - `Generated<T>`: column with a server-side default (DEFAULT (datetime('now')),
//   DEFAULT (lower(hex(randomblob(16)))), etc.). Optional on insert; always
//   present on select.
// - `string | null` columns are nullable in SQLite (no NOT NULL). Always
//   require explicit `null` on insert if not set.
// - INTEGER booleans (`is_impersonation`, `geo_enabled`, `healthy`) are typed
//   as `0 | 1` so the type checker rejects accidental `true`/`false`.
//
// CHECK constraints on columns like `tenants.plan` and `agent_summaries.status`
// are mirrored as union string literals — the DB rejects out-of-set values,
// but the type checker rejects them at the call site, which is the better
// failure mode.

import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

// ─── Tenants ──────────────────────────────────────────────────────────────

export type TenantPlan = "hobby" | "pro" | "starter" | "growth" | "enterprise";
export type TenantStatus = "pending" | "active" | "suspended";

export interface TenantTable {
  id: string;
  name: string;
  plan: Generated<TenantPlan>;
  max_configs: Generated<number>;
  max_agents_per_config: Generated<number>;
  geo_enabled: Generated<0 | 1>;
  status: Generated<TenantStatus>;
  approved_at: string | null;
  approved_by: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ─── Users / sessions / auth identities ──────────────────────────────────

export type UserRole = "member" | "admin";

export interface UserTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  display_name: string;
  role: Generated<UserRole>;
  tenant_id: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface SessionTable {
  id: string;
  user_id: string;
  expires_at: string;
  is_impersonation: Generated<0 | 1>;
  impersonator_user_id: string | null;
  created_at: Generated<string>;
}

export interface AuthIdentityTable {
  id: Generated<string>;
  user_id: string;
  provider: string;
  provider_user_id: string;
  provider_login: string | null;
  provider_email: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ─── Configurations / versions / enrollment ──────────────────────────────

export interface ConfigurationTable {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  current_config_hash: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ConfigVersionTable {
  id: string;
  config_id: string;
  tenant_id: string;
  config_hash: string;
  r2_key: string;
  size_bytes: number;
  created_by: string | null;
  created_at: Generated<string>;
}

export interface EnrollmentTokenTable {
  id: string;
  config_id: string;
  tenant_id: string;
  token_hash: string;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: Generated<string>;
}

export interface PendingTokenTable {
  id: Generated<string>;
  tenant_id: string;
  token_hash: string;
  label: string | null;
  target_config_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: Generated<string>;
}

// ─── Agent summaries ─────────────────────────────────────────────────────

export type AgentStatus = "connected" | "disconnected" | "unknown";

export interface AgentSummaryTable {
  instance_uid: string;
  tenant_id: string;
  config_id: string;
  status: Generated<AgentStatus>;
  healthy: Generated<0 | 1>;
  current_config_hash: string | null;
  last_seen_at: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  agent_description: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ─── Audit logs ──────────────────────────────────────────────────────────

export type AuditStatus = "success" | "failure";

export interface AuditLogTable {
  id: string;
  // NULL = admin-scoped (platform action not tied to a customer).
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_api_key_id: string | null;
  actor_email: string | null;
  actor_ip: string | null;
  actor_user_agent: string | null;
  impersonator_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  status: AuditStatus;
  // 100..599 by CHECK constraint; nullable for non-HTTP audit events.
  status_code: number | null;
  metadata: string | null;
  request_id: string | null;
  created_at: Generated<string>;
}

// ─── GitHub App installations ────────────────────────────────────────────

export type GithubAccountType = "User" | "Organization";

export interface GithubInstallationTable {
  installation_id: number;
  account_login: string;
  account_type: GithubAccountType;
  tenant_id: string | null;
  config_path: Generated<string>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface InstallationRepositoryTable {
  installation_id: number;
  repo_id: number;
  full_name: string;
  default_branch: string | null;
}

// ─── Database surface ────────────────────────────────────────────────────

export interface Database {
  tenants: TenantTable;
  users: UserTable;
  sessions: SessionTable;
  auth_identities: AuthIdentityTable;
  configurations: ConfigurationTable;
  config_versions: ConfigVersionTable;
  enrollment_tokens: EnrollmentTokenTable;
  pending_tokens: PendingTokenTable;
  agent_summaries: AgentSummaryTable;
  audit_logs: AuditLogTable;
  github_installations: GithubInstallationTable;
  installation_repositories: InstallationRepositoryTable;
}

// ─── Convenience row types ───────────────────────────────────────────────

export type Tenant = Selectable<TenantTable>;
export type NewTenant = Insertable<TenantTable>;
export type TenantUpdate = Updateable<TenantTable>;

export type User = Selectable<UserTable>;
export type NewUser = Insertable<UserTable>;
export type UserUpdate = Updateable<UserTable>;

export type Configuration = Selectable<ConfigurationTable>;
export type NewConfiguration = Insertable<ConfigurationTable>;
export type ConfigurationUpdate = Updateable<ConfigurationTable>;

export type ConfigVersion = Selectable<ConfigVersionTable>;
export type EnrollmentToken = Selectable<EnrollmentTokenTable>;
export type AuditLog = Selectable<AuditLogTable>;
export type AgentSummary = Selectable<AgentSummaryTable>;
export type Session = Selectable<SessionTable>;
export type AuthIdentity = Selectable<AuthIdentityTable>;

// `ColumnType` re-exported so call sites can construct refined column types
// without a separate kysely import.
export type { ColumnType };
