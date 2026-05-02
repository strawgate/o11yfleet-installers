import { lazy, Suspense, type ComponentType } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import MarketingLayout from "@/layouts/MarketingLayout";

import HomePage from "@/pages/marketing/HomePage";
import AboutPage from "@/pages/marketing/AboutPage";
import PricingPage from "@/pages/marketing/PricingPage";
import EnterprisePage from "@/pages/marketing/EnterprisePage";
import PartnersPage from "@/pages/marketing/PartnersPage";
import ProductConfigPage from "@/pages/marketing/ProductConfigPage";
import GitOpsPage from "@/pages/marketing/GitOpsPage";

import LoginPage from "@/pages/auth/LoginPage";
import AdminLoginPage from "@/pages/auth/AdminLoginPage";
import SignupPage from "@/pages/auth/SignupPage";
import ForgotPage from "@/pages/auth/ForgotPage";

import NotFoundPage from "@/pages/NotFoundPage";
import { Button } from "@/components/ui/button";

function ChunkLoadError({ name }: { name: string }) {
  return (
    <div className="grid min-h-[40vh] place-items-center px-6 py-12 text-center">
      <div className="max-w-md">
        <h2 className="text-xl font-medium">Failed to load {name}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This usually happens after a deployment. A refresh should fix it.
        </p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
    </div>
  );
}

function lazyPage(
  loader: () => Promise<{ default: ComponentType }>,
  name: string,
): React.LazyExoticComponent<ComponentType> {
  return lazy(() =>
    loader().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const isChunkLoadError =
        /ChunkLoadError|Loading chunk \d+ failed|Failed to fetch dynamically imported module/i.test(
          message,
        );
      if (!isChunkLoadError) throw error;
      return { default: () => <ChunkLoadError name={name} /> };
    }),
  );
}

const PortalLayout = lazy(() => import("@/layouts/PortalLayout"));
const OverviewPage = lazyPage(() => import("@/pages/portal/OverviewPage"), "Overview");
const AgentsPage = lazyPage(() => import("@/pages/portal/AgentsPage"), "Agents");
const AgentDetailPage = lazyPage(() => import("@/pages/portal/AgentDetailPage"), "Agent Detail");
const ConfigurationsPage = lazyPage(
  () => import("@/pages/portal/ConfigurationsPage"),
  "Configurations",
);
const ConfigurationDetailPage = lazyPage(
  () => import("@/pages/portal/ConfigurationDetailPage"),
  "Configuration Detail",
);
const BuilderPage = lazyPage(() => import("@/pages/portal/BuilderPage"), "Builder");
const GettingStartedPage = lazyPage(
  () => import("@/pages/portal/GettingStartedPage"),
  "Getting Started",
);
const OnboardingPage = lazyPage(() => import("@/pages/portal/OnboardingPage"), "Onboarding");
const TokensPage = lazyPage(() => import("@/pages/portal/TokensPage"), "Tokens");
const PendingDevicesPage = lazyPage(
  () => import("@/pages/portal/PendingDevicesPage"),
  "Pending Devices",
);
const TeamPage = lazyPage(() => import("@/pages/portal/TeamPage"), "Team");
const BillingPage = lazyPage(() => import("@/pages/portal/BillingPage"), "Billing");
const SettingsPage = lazyPage(() => import("@/pages/portal/SettingsPage"), "Settings");
const PendingApprovalPage = lazyPage(
  () => import("@/pages/portal/PendingApprovalPage"),
  "Pending Approval",
);

const AdminLayout = lazy(() => import("@/layouts/AdminLayout"));
const AdminOverviewPage = lazyPage(() => import("@/pages/admin/OverviewPage"), "Admin Overview");
const TenantsPage = lazyPage(() => import("@/pages/admin/TenantsPage"), "Tenants");
const TenantDetailPage = lazyPage(() => import("@/pages/admin/TenantDetailPage"), "Tenant Detail");
const HealthPage = lazyPage(() => import("@/pages/admin/HealthPage"), "Health");
const UsagePage = lazyPage(() => import("@/pages/admin/UsagePage"), "Usage");
const SupportPage = lazyPage(() => import("@/pages/admin/SupportPage"), "Support");
const DOViewerPage = lazyPage(() => import("@/pages/admin/DOViewerPage"), "Durable Object Viewer");
const PlansPage = lazyPage(() => import("@/pages/admin/PlansPage"), "Plans");
const AdminApiReferencePage = lazyPage(
  () => import("@/pages/admin/ApiReferencePage"),
  "Admin API Reference",
);

// Dev-only playgrounds. Not registered in production builds.
const SpinePlayground = import.meta.env.DEV
  ? lazyPage(
      () =>
        import("@/pages/playground/SpinePlayground").then((m) => ({ default: m.SpinePlayground })),
      "Spine Playground",
    )
  : null;
const DiffPlayground = import.meta.env.DEV
  ? lazyPage(
      () =>
        import("@/pages/playground/DiffPlayground").then((m) => ({
          default: m.DiffPlayground,
        })),
      "Diff Playground",
    )
  : null;
const BuilderPlayground = import.meta.env.DEV
  ? lazyPage(
      () =>
        import("@/pages/playground/BuilderPlayground").then((m) => ({
          default: m.BuilderPlayground,
        })),
      "Builder Playground",
    )
  : null;
const DataTablePlayground = import.meta.env.DEV
  ? lazyPage(
      () =>
        import("@/pages/playground/DataTablePlayground").then((m) => ({
          default: m.DataTablePlayground,
        })),
      "DataTable Playground",
    )
  : null;

function SuspenseFallback() {
  return <div className="flex justify-center p-16">Loading...</div>;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<SuspenseFallback />}>
      <Routes>
        <Route path="admin/login" element={<AdminLoginPage />} />
        <Route path="admin-login" element={<Navigate to="/admin/login" replace />} />

        <Route element={<MarketingLayout />}>
          <Route index element={<HomePage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="pricing" element={<PricingPage />} />
          <Route path="enterprise" element={<EnterprisePage />} />
          <Route path="partners" element={<PartnersPage />} />
          <Route
            path="product"
            element={<Navigate to="/product/configuration-management" replace />}
          />
          <Route
            path="product/config"
            element={<Navigate to="/product/configuration-management" replace />}
          />
          <Route path="product/configuration-management" element={<ProductConfigPage />} />
          <Route path="solutions/gitops" element={<GitOpsPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
          <Route path="forgot" element={<ForgotPage />} />
        </Route>

        <Route path="portal" element={<PortalLayout />}>
          <Route index element={<Navigate to="/portal/overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/:configId/:agentUid" element={<AgentDetailPage />} />
          <Route path="configurations" element={<ConfigurationsPage />} />
          <Route path="configurations/:id" element={<ConfigurationDetailPage />} />
          <Route path="builder" element={<BuilderPage />} />
          <Route path="getting-started" element={<GettingStartedPage />} />
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route path="tokens" element={<TokensPage />} />
          <Route path="pending-devices" element={<PendingDevicesPage />} />
          <Route path="pending-approval" element={<PendingApprovalPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="/admin/overview" replace />} />
          <Route path="overview" element={<AdminOverviewPage />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="tenants/:id" element={<TenantDetailPage />} />
          <Route path="health" element={<HealthPage />} />
          <Route path="api" element={<AdminApiReferencePage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="support" element={<SupportPage />} />
          <Route path="do-viewer" element={<DOViewerPage />} />
          <Route path="plans" element={<PlansPage />} />
        </Route>

        {SpinePlayground && <Route path="playground/spine" element={<SpinePlayground />} />}
        {DiffPlayground && <Route path="playground/diff" element={<DiffPlayground />} />}
        {BuilderPlayground && <Route path="playground/builder" element={<BuilderPlayground />} />}
        {DataTablePlayground && (
          <Route path="playground/data-table" element={<DataTablePlayground />} />
        )}

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
