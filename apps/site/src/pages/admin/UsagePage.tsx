import { useMemo } from "react";
import { useAdminUsage, type AdminUsageService } from "../../api/hooks/admin";
import { useAdminGuidance } from "../../api/hooks/ai";
import { buildInsightRequest, insightSurfaces, insightTarget } from "../../ai/insight-registry";
import { useRegisterBrowserContext } from "../../ai/browser-context-react";
import { buildBrowserPageContext, pageMetric, pageTable } from "../../ai/page-context";
import { GuidancePanel, GuidanceSlot } from "../../components/ai";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { relTime } from "../../utils/format";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

function money(value: number | undefined): string {
  return `$${(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

function numberMetric(value: number | undefined): string {
  return typeof value === "number" ? value.toLocaleString() : "-";
}

function statusTag(status: AdminUsageService["status"]) {
  const cls = status === "ready" ? "tag-ok" : status === "not_configured" ? "tag-warn" : "tag-err";
  return <span className={`tag ${cls}`}>{status.replace("_", " ")}</span>;
}

function mainUnit(service: AdminUsageService): string {
  const first = service.line_items[0];
  if (first) return `${numberMetric(first.quantity)} ${first.unit}`;
  const dailyUnits = service.daily.flatMap((day) => Object.values(day.units));
  const total = dailyUnits.reduce((sum, value) => sum + value, 0);
  return total > 0 ? numberMetric(total) : "No usage";
}

function maxDailySpend(service: AdminUsageService): number {
  return Math.max(0.01, ...service.daily.map((day) => day.estimated_spend_usd));
}

function DailyBars({ service }: { service: AdminUsageService }) {
  const max = maxDailySpend(service);
  if (service.daily.length === 0) {
    return <p className="meta mt-4">Daily usage appears here once this source is configured.</p>;
  }
  return (
    <div className="usage-bars mt-4" aria-label={`${service.name} daily estimated spend`}>
      {service.daily.map((day) => (
        <span
          key={day.date}
          className="usage-bar"
          style={{ height: `${Math.max(8, (day.estimated_spend_usd / max) * 96)}px` }}
          tabIndex={0}
          aria-label={`${day.date}: ${money(day.estimated_spend_usd)}`}
          title={`${day.date}: ${money(day.estimated_spend_usd)}`}
        >
          <span>{new Date(`${day.date}T00:00:00Z`).getUTCDate()}</span>
        </span>
      ))}
    </div>
  );
}

function ServiceCard({ service }: { service: AdminUsageService }) {
  return (
    <section className="card card-pad usage-service-card">
      <div className="support-section-head">
        <div>
          <h3>{service.name}</h3>
          <p className="meta">{service.source}</p>
        </div>
        {statusTag(service.status)}
      </div>

      <div className="usage-service-stats mt-4">
        <span>
          <strong>{mainUnit(service)}</strong>
          <span className="meta">month-to-date usage</span>
        </span>
        <span>
          <strong>{money(service.month_to_date_estimated_spend_usd)}</strong>
          <span className="meta">month-to-date estimate</span>
        </span>
        <span>
          <strong>{money(service.projected_month_estimated_spend_usd)}</strong>
          <span className="meta">month projection</span>
        </span>
      </div>

      <DailyBars service={service} />

      {service.error ? <p className="usage-error mt-4">{service.error}</p> : null}

      {service.line_items.length > 0 ? (
        <div className="usage-line-items mt-4">
          {service.line_items.map((item) => (
            <div key={item.label} className="usage-line-item">
              <span>
                <strong>{item.label}</strong>
                <span className="meta">
                  {numberMetric(item.quantity)} {item.unit} / {numberMetric(item.included)} included
                </span>
              </span>
              <span>
                <strong>{money(item.estimated_spend_usd)}</strong>
                <span className="meta">{numberMetric(item.billable)} billable</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {service.notes.length > 0 ? (
        <ul className="usage-notes mt-4">
          {service.notes.map((note, index) => (
            <li key={`${note}-${index}`}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default function UsagePage() {
  const { data, isLoading, error, refetch } = useAdminUsage();
  const readyServices = useMemo(
    () => data?.services.filter((service) => service.status === "ready").length ?? 0,
    [data?.services],
  );
  const insightSurface = insightSurfaces.adminUsage;
  const pageContext = data
    ? buildBrowserPageContext({
        title: "Usage and spend",
        visible_text: [
          "Usage and spend estimates come from usage metrics and explicit pricing assumptions, not lagging Cloudflare billing totals.",
        ],
        metrics: [
          pageMetric(
            "month_to_date_estimated_spend_usd",
            "Month-to-date estimate",
            data.month_to_date_estimated_spend_usd,
            { unit: "USD" },
          ),
          pageMetric(
            "projected_month_estimated_spend_usd",
            "Projected month",
            data.projected_month_estimated_spend_usd,
            { unit: "USD" },
          ),
          pageMetric("ready_usage_sources", "Ready usage sources", readyServices),
          pageMetric("total_usage_sources", "Total usage sources", data.services.length),
          pageMetric("required_env_count", "Required env vars", data.required_env.length),
        ],
        tables: [
          pageTable(
            "usage_services",
            "Usage services",
            data.services.map((service) => ({
              id: service.id,
              name: service.name,
              status: service.status,
              source: service.source,
              month_to_date_estimated_spend_usd: service.month_to_date_estimated_spend_usd,
              projected_month_estimated_spend_usd: service.projected_month_estimated_spend_usd,
              line_items: service.line_items.length,
              notes: service.notes.length,
            })),
            { totalRows: data.services.length },
          ),
        ],
      })
    : null;
  const guidanceRequest: AiGuidanceRequest | null =
    data && pageContext
      ? buildInsightRequest(
          insightSurface,
          [
            insightTarget(insightSurface, insightSurface.targets.page),
            insightTarget(insightSurface, insightSurface.targets.spend, {
              projected_month_estimated_spend_usd: data.projected_month_estimated_spend_usd,
            }),
            insightTarget(insightSurface, insightSurface.targets.sources, {
              ready_usage_sources: readyServices,
              total_usage_sources: data.services.length,
            }),
            insightTarget(insightSurface, insightSurface.targets.services),
          ],
          {
            month_to_date_estimated_spend_usd: data.month_to_date_estimated_spend_usd,
            projected_month_estimated_spend_usd: data.projected_month_estimated_spend_usd,
            ready_usage_sources: readyServices,
            total_usage_sources: data.services.length,
            required_env_count: data.required_env.length,
            configured: data.configured,
          },
          { intent: "triage_state", pageContext },
        )
      : null;
  const browserContext = useMemo(
    () => ({
      id: "admin.usage.page",
      title: "Usage and spend",
      surface: insightSurface.surface,
      context: guidanceRequest?.context ?? {},
      targets: guidanceRequest?.targets ?? [],
      pageContext: guidanceRequest?.page_context ?? undefined,
    }),
    [
      guidanceRequest?.context,
      guidanceRequest?.page_context,
      guidanceRequest?.targets,
      insightSurface.surface,
    ],
  );
  useRegisterBrowserContext(guidanceRequest ? browserContext : null);
  const guidance = useAdminGuidance(guidanceRequest);
  const spendInsight = guidance.data?.items.find(
    (item) => item.target_key === "admin.usage.spend" || item.target_key === "admin.usage.page",
  );
  const sourceInsight = guidance.data?.items.find(
    (item) => item.target_key === "admin.usage.sources",
  );

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;
  if (!data) return null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Usage & Spend</h1>
          <p className="meta">
            Daily Cloudflare usage, estimated month-to-date spend, and projected monthly cost for
            the services O11yFleet relies on.
          </p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost btn-sm" onClick={() => void refetch()}>
            Refresh
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="val">{money(data.month_to_date_estimated_spend_usd)}</div>
          <div className="label">Month-to-date estimate</div>
          <GuidanceSlot item={spendInsight} loading={guidance.isLoading} />
        </div>
        <div className="stat">
          <div className="val">{money(data.projected_month_estimated_spend_usd)}</div>
          <div className="label">Projected month</div>
        </div>
        <div className="stat">
          <div className="val">
            {data.window.days_elapsed}/{data.window.days_in_month}
          </div>
          <div className="label">Days measured</div>
        </div>
        <div className="stat">
          <div className="val">
            {readyServices}/{data.services.length}
          </div>
          <div className="label">Sources connected</div>
          <GuidanceSlot item={sourceInsight} loading={guidance.isLoading} />
        </div>
      </div>

      <GuidancePanel
        title="Usage guidance"
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
        excludeTargetKeys={["admin.usage.spend", "admin.usage.sources"]}
      />

      <section className="admin-callout mt-6">
        <strong>Estimated from usage metrics, not Cloudflare billing totals</strong>
        <p>
          Cloudflare usage-based billing can lag and may omit usage still inside included
          allowances. This page queries usage surfaces directly and applies explicit pricing/free
          tier assumptions so $0 free-tier usage still shows up as usage.
        </p>
      </section>

      {data.required_env.length > 0 ? (
        <section className="card card-pad mt-6">
          <h3>Configuration needed</h3>
          <p className="meta mt-2">
            Add these Worker secrets/vars to enable live Cloudflare usage queries:
          </p>
          <div className="usage-env-grid mt-4">
            {data.required_env.map((key) => (
              <code key={key}>{key}</code>
            ))}
          </div>
        </section>
      ) : null}

      <div className="usage-grid mt-6">
        {data.services.map((service) => (
          <ServiceCard key={service.id} service={service} />
        ))}
      </div>

      <section className="card card-pad mt-6">
        <h3>Pricing assumptions</h3>
        <p className="meta mt-2">{data.pricing.source}</p>
        <ul className="usage-notes mt-4">
          {data.pricing.notes.map((note, index) => (
            <li key={`${note}-${index}`}>{note}</li>
          ))}
        </ul>
        <p className="meta mt-4">Generated {relTime(data.generated_at)}</p>
      </section>
    </>
  );
}
