import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminHealth, useAdminTenants } from "../../api/hooks/admin";
import { useToast } from "../../components/common/Toast";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";
import { SYMPTOMS, buildSupportBrief, healthLabel, healthTone, normalize } from "./support-model";

export default function SupportPage() {
  const tenantsQuery = useAdminTenants();
  const healthQuery = useAdminHealth();
  const { toast } = useToast();

  const [tenantQuery, setTenantQuery] = useState("");
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [selectedSymptomId, setSelectedSymptomId] = useState(SYMPTOMS[0]?.id ?? "");
  const [visibleTenantCount, setVisibleTenantCount] = useState(12);

  const tenants = tenantsQuery.data ?? [];
  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) ?? null;
  const selectedSymptom =
    SYMPTOMS.find((symptom) => symptom.id === selectedSymptomId) ?? SYMPTOMS[0] ?? null;
  const health = healthQuery.data;
  const healthChecks = health?.checks ?? {};
  const query = normalize(tenantQuery);
  const filteredTenants = query
    ? tenants.filter((tenant) => normalize(`${tenant.name} ${tenant.id}`).includes(query))
    : tenants;
  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(supportBrief);
      toast("Copied support brief");
    } catch {
      toast("Copy failed", "Clipboard access is blocked in this browser context.", "err");
    }
  }

  if (tenantsQuery.isLoading || healthQuery.isLoading) return <LoadingSpinner />;
  if (tenantsQuery.error)
    return <ErrorState error={tenantsQuery.error} retry={() => void tenantsQuery.refetch()} />;
  if (healthQuery.error)
    return <ErrorState error={healthQuery.error} retry={() => void healthQuery.refetch()} />;
  if (!selectedSymptom) {
    return <ErrorState error={new Error("No symptoms configured")} />;
  }

  const displayedTenants = filteredTenants.slice(0, visibleTenantCount);
  const moreTenantMatches = filteredTenants.length > displayedTenants.length;
  const supportBrief = buildSupportBrief({
    tenant: selectedTenant,
    symptom: selectedSymptom,
    health,
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Support cockpit</h1>
          <p className="meta">
            Tenant-scoped starting point for symptom-first support triage. Pick the customer pain
            first, then jump to the admin screen that can confirm it.
          </p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost btn-sm" onClick={() => void healthQuery.refetch()}>
            Refresh health
          </button>
        </div>
      </div>

      <div className="support-grid mt-6">
        <section className="card card-pad">
          <h3>1. Select tenant</h3>
          <div className="field mt-4">
            <label htmlFor="support-tenant-filter">Search by tenant name or ID</label>
            <input
              id="support-tenant-filter"
              className="input"
              value={tenantQuery}
              onChange={(event) => {
                setTenantQuery(event.target.value);
                setVisibleTenantCount(12);
              }}
              placeholder="acme, tenant id"
            />
          </div>

          <div className="support-tenant-list mt-4">
            {filteredTenants.length === 0 ? (
              <EmptyState
                icon="search"
                title="No tenant matches"
                description="Try a broader name or clear the search term."
              />
            ) : (
              displayedTenants.map((tenant) => (
                <button
                  key={tenant.id}
                  type="button"
                  className={`support-tenant-item${selectedTenant?.id === tenant.id ? " selected" : ""}`}
                  onClick={() => setSelectedTenantId(tenant.id)}
                >
                  <span>
                    <strong>{tenant.name}</strong>
                    <span className="meta mono">{tenant.id}</span>
                  </span>
                  <PlanTag plan={tenant.plan ?? "starter"} />
                </button>
              ))
            )}
          </div>
          {filteredTenants.length > 0 ? (
            <div className="support-list-footer mt-3">
              <span className="meta">
                Showing {displayedTenants.length} of {filteredTenants.length} matching tenants.
              </span>
              {moreTenantMatches ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setVisibleTenantCount((count) => count + 12)}
                >
                  Show more
                </button>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="card card-pad">
          <h3>2. Choose symptom</h3>
          <div className="support-symptom-list mt-4">
            {SYMPTOMS.map((symptom) => (
              <button
                key={symptom.id}
                className={`support-symptom-card${selectedSymptom.id === symptom.id ? " selected" : ""}`}
                onClick={() => setSelectedSymptomId(symptom.id)}
                type="button"
              >
                <strong>{symptom.title}</strong>
                <span className="meta">{symptom.summary}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="support-grid mt-6">
        <section className="card card-pad">
          <div className="support-section-head">
            <h3>3. Health context</h3>
            <Link to="/admin/health" className="btn btn-ghost btn-sm">
              Open health
            </Link>
          </div>
          <div className="support-chip-wrap mt-4">
            <span className={`support-chip tone-${healthTone(health?.status)}`}>
              <span>Overall</span>
              <strong>{health?.status ?? "unknown"}</strong>
            </span>
            {Object.entries(healthChecks).map(([key, check]) => (
              <span key={key} className={`support-chip tone-${healthTone(check.status)}`}>
                <span>{healthLabel(key)}</span>
                <strong>{check.status ?? "unknown"}</strong>
                {check.latency_ms !== null && check.latency_ms !== undefined ? (
                  <small>{check.latency_ms}ms</small>
                ) : null}
              </span>
            ))}
            {Object.keys(healthChecks).length === 0 ? (
              <span className="meta">No dependency checks reported.</span>
            ) : null}
          </div>
        </section>

        <section className="card card-pad">
          <h3>4. Next admin screens</h3>
          <p className="meta mt-2">{selectedSymptom.whyItMatters}</p>
          <div className="support-actions mt-4">
            {selectedSymptom.steps.map((step) => {
              const href = step.path(selectedTenant?.id ?? null);
              const disabled = step.requiresTenant && !selectedTenant;
              return (
                <div key={step.label} className="support-action-row">
                  <span>
                    <strong>{step.label}</strong>
                    <span className="meta">{step.description}</span>
                  </span>
                  {disabled ? (
                    <button type="button" className="btn btn-secondary" disabled>
                      Open
                    </button>
                  ) : (
                    <Link to={href} className="btn btn-secondary">
                      Open
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
          {!selectedTenant ? (
            <p className="meta mt-3">Select a tenant to enable tenant-specific links.</p>
          ) : null}
        </section>
      </div>

      <section className="card card-pad mt-6">
        <div className="support-section-head">
          <h3>Support brief</h3>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void copyBrief()}>
            Copy brief
          </button>
        </div>
        <pre className="support-brief mt-4">{supportBrief}</pre>
      </section>
    </>
  );
}
