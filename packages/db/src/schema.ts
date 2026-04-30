// D1 schema types — mirrors the SQL DDL

export interface Tenant {
  id: string;
  name: string;
  plan: "hobby" | "pro" | "starter" | "growth" | "enterprise";
  max_configs: number;
  max_agents_per_config: number;
  created_at: string;
  updated_at: string;
}

export interface Configuration {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  current_config_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConfigVersion {
  id: string;
  config_id: string;
  tenant_id: string;
  config_hash: string;
  r2_key: string;
  size_bytes: number;
  created_by: string | null;
  created_at: string;
}

export interface EnrollmentToken {
  id: string;
  config_id: string;
  tenant_id: string;
  token_hash: string;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface AgentSummary {
  instance_uid: string;
  tenant_id: string;
  config_id: string;
  status: "connected" | "disconnected" | "unknown";
  healthy: boolean;
  current_config_hash: string | null;
  last_seen_at: string;
  connected_at: string | null;
  disconnected_at: string | null;
  agent_description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  expires_at: string;
  is_impersonation: boolean;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: "member" | "admin";
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthIdentity {
  id: string;
  user_id: string;
  provider: "github";
  provider_user_id: string;
  provider_login: string | null;
  provider_email: string | null;
  created_at: string;
  updated_at: string;
}
