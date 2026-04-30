import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { ToastProvider } from "./components/common/Toast";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { AuthError } from "./api/client";
import { BrowserContextProvider } from "./ai/browser-context-react";
import { TooltipProvider } from "./components/ui/tooltip";
import MarketingLayout from "./layouts/MarketingLayout";

/* ------------------------------------------------------------------ */
/*  Query client with global auth error handling                       */
/* ------------------------------------------------------------------ */

function handleGlobalError(error: Error) {
  if (error instanceof AuthError) {
    queryClient.setQueryData(["auth", "me"], null);

    // Don't redirect if already on an auth page; login/signup/forgot own
    // their empty-session states.
    const path = window.location.pathname;
    if (
      path === "/login" ||
      path === "/signup" ||
      path === "/forgot" ||
      path === "/admin/login" ||
      path === "/admin-login"
    ) {
      return;
    }

    // Session expired — redirect to login.
    // Use replaceState + popstate so React Router handles it client-side
    // instead of a full page navigation (which would hit CDN cache).
    const dest = path.startsWith("/admin") ? "/admin/login" : "/login";
    window.history.replaceState({}, "", dest);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleGlobalError }),
  mutationCache: new MutationCache({ onError: handleGlobalError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof AuthError) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: true,
    },
  },
});

/* ------------------------------------------------------------------ */
/*  Chunk load error fallback                                          */
/* ------------------------------------------------------------------ */

function ChunkLoadError({ name }: { name: string }) {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2>Failed to load {name}</h2>
      <p style={{ marginBottom: "1rem", color: "var(--t3)" }}>
        This usually happens after a deployment. A refresh should fix it.
      </p>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>
        Reload page
      </button>
    </div>
  );
}

function lazyPage(
  loader: () => Promise<{ default: React.ComponentType }>,
  name: string,
): React.LazyExoticComponent<React.ComponentType> {
  return lazy(() =>
    loader().catch(() => ({
      default: () => <ChunkLoadError name={name} />,
    })),
  );
}

/* ------------------------------------------------------------------ */
/*  Marketing pages                                                    */
/* ------------------------------------------------------------------ */

import HomePage from "./pages/marketing/HomePage";
import AboutPage from "./pages/marketing/AboutPage";
import PricingPage from "./pages/marketing/PricingPage";
import EnterprisePage from "./pages/marketing/EnterprisePage";
import PartnersPage from "./pages/marketing/PartnersPage";
import ProductConfigPage from "./pages/marketing/ProductConfigPage";
import GitOpsPage from "./pages/marketing/GitOpsPage";

/* ------------------------------------------------------------------ */
/*  Auth pages                                                         */
/* ------------------------------------------------------------------ */

import LoginPage from "./pages/auth/LoginPage";
import AdminLoginPage from "./pages/auth/AdminLoginPage";
import SignupPage from "./pages/auth/SignupPage";
import ForgotPage from "./pages/auth/ForgotPage";

/* ------------------------------------------------------------------ */
/*  Portal pages (lazy)                                                */
/* ------------------------------------------------------------------ */

const PortalLayout = lazy(() => import("./layouts/PortalLayout"));

const OverviewPage = lazyPage(() => import("./pages/portal/OverviewPage"), "Overview");
const AgentsPage = lazyPage(() => import("./pages/portal/AgentsPage"), "Agents");
const AgentDetailPage = lazyPage(() => import("./pages/portal/AgentDetailPage"), "Agent Detail");
const ConfigurationsPage = lazyPage(
  () => import("./pages/portal/ConfigurationsPage"),
  "Configurations",
);
const ConfigurationDetailPage = lazyPage(
  () => import("./pages/portal/ConfigurationDetailPage"),
  "Configuration Detail",
);
const BuilderPage = lazyPage(() => import("./pages/portal/BuilderPage"), "Builder");
const GettingStartedPage = lazyPage(
  () => import("./pages/portal/GettingStartedPage"),
  "Getting Started",
);
const OnboardingPage = lazyPage(() => import("./pages/portal/OnboardingPage"), "Onboarding");
const TokensPage = lazyPage(() => import("./pages/portal/TokensPage"), "Tokens");
const TeamPage = lazyPage(() => import("./pages/portal/TeamPage"), "Team");
const BillingPage = lazyPage(() => import("./pages/portal/BillingPage"), "Billing");
const SettingsPage = lazyPage(() => import("./pages/portal/SettingsPage"), "Settings");

/* ------------------------------------------------------------------ */
/*  Admin pages (lazy)                                                 */
/* ------------------------------------------------------------------ */

const AdminLayout = lazy(() => import("./layouts/AdminLayout"));

const AdminOverviewPage = lazyPage(() => import("./pages/admin/OverviewPage"), "Admin Overview");
const TenantsPage = lazyPage(() => import("./pages/admin/TenantsPage"), "Tenants");
const TenantDetailPage = lazyPage(() => import("./pages/admin/TenantDetailPage"), "Tenant Detail");
const HealthPage = lazyPage(() => import("./pages/admin/HealthPage"), "Health");
const UsagePage = lazyPage(() => import("./pages/admin/UsagePage"), "Usage");
const SupportPage = lazyPage(() => import("./pages/admin/SupportPage"), "Support");
const DOViewerPage = lazyPage(() => import("./pages/admin/DOViewerPage"), "Durable Object Viewer");
const PlansPage = lazyPage(() => import("./pages/admin/PlansPage"), "Plans");
const AdminApiReferencePage = lazyPage(
  () => import("./pages/admin/ApiReferencePage"),
  "Admin API Reference",
);

/* ------------------------------------------------------------------ */
/*  404 page                                                           */
/* ------------------------------------------------------------------ */

import NotFoundPage from "./pages/NotFoundPage";

/* ------------------------------------------------------------------ */
/*  Loading fallback                                                   */
/* ------------------------------------------------------------------ */

function SuspenseFallback() {
  return <div style={{ display: "flex", justifyContent: "center", padding: "4rem" }}>Loading…</div>;
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TooltipProvider>
          <BrowserRouter>
            <BrowserContextProvider>
              <ErrorBoundary>
                <Suspense fallback={<SuspenseFallback />}>
                  <Routes>
                    <Route path="admin/login" element={<AdminLoginPage />} />
                    <Route path="admin-login" element={<Navigate to="/admin/login" replace />} />

                    {/* Marketing */}
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
                      <Route
                        path="product/configuration-management"
                        element={<ProductConfigPage />}
                      />
                      <Route path="solutions/gitops" element={<GitOpsPage />} />
                      <Route path="login" element={<LoginPage />} />
                      <Route path="signup" element={<SignupPage />} />
                      <Route path="forgot" element={<ForgotPage />} />
                    </Route>

                    {/* Portal (auth required — enforced by PortalLayout) */}
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
                      <Route path="team" element={<TeamPage />} />
                      <Route path="billing" element={<BillingPage />} />
                      <Route path="settings" element={<SettingsPage />} />
                    </Route>

                    {/* Admin (admin auth required — enforced by AdminLayout) */}
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

                    {/* 404 catch-all */}
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </BrowserContextProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
