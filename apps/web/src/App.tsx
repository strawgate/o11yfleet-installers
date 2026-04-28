import { Routes, Route, Navigate } from "react-router-dom";
import { PortalLayout } from "./layouts/PortalLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { LoginPage } from "./pages/Login";
import { AdminLoginPage } from "./pages/AdminLogin";
import { OverviewPage } from "./pages/portal/Overview";
import { ConfigurationsPage } from "./pages/portal/Configurations";
import { ConfigurationDetailPage } from "./pages/portal/ConfigurationDetail";
import { AgentsPage } from "./pages/portal/Agents";
import { GettingStartedPage } from "./pages/portal/GettingStarted";
import { SettingsPage } from "./pages/portal/Settings";
import { PrototypePage } from "./pages/portal/Prototype";
import { AdminOverviewPage } from "./pages/admin/Overview";
import { TenantsPage } from "./pages/admin/Tenants";
import { TenantDetailPage } from "./pages/admin/TenantDetail";
import { AdminPrototypePage } from "./pages/admin/Prototype";
import { RequireAuth, RequireAdmin } from "./lib/auth";

export function App() {
  return (
    <Routes>
      {/* Auth */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin-login" element={<AdminLoginPage />} />

      {/* Portal */}
      <Route element={<RequireAuth><PortalLayout /></RequireAuth>}>
        <Route path="/portal/overview" element={<OverviewPage />} />
        <Route path="/portal/configurations" element={<ConfigurationsPage />} />
        <Route path="/portal/configurations/:id" element={<ConfigurationDetailPage />} />
        <Route path="/portal/agents" element={<AgentsPage />} />
        <Route path="/portal/getting-started" element={<GettingStartedPage />} />
        <Route path="/portal/settings" element={<SettingsPage />} />
        <Route path="/portal/tokens" element={<PrototypePage title="API Tokens" />} />
        <Route path="/portal/team" element={<PrototypePage title="Team" />} />
        <Route path="/portal/billing" element={<PrototypePage title="Plan & Billing" />} />
        <Route path="/portal/builder" element={<PrototypePage title="Pipeline Builder" />} />
      </Route>

      {/* Admin */}
      <Route element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
        <Route path="/admin/overview" element={<AdminOverviewPage />} />
        <Route path="/admin/tenants" element={<TenantsPage />} />
        <Route path="/admin/tenants/:id" element={<TenantDetailPage />} />
        <Route path="/admin/health" element={<AdminPrototypePage title="System Health" />} />
        <Route path="/admin/events" element={<AdminPrototypePage title="Audit Events" />} />
        <Route path="/admin/plans" element={<AdminPrototypePage title="Plans & Pricing" />} />
        <Route path="/admin/flags" element={<AdminPrototypePage title="Feature Flags" />} />
      </Route>

      {/* Redirects */}
      <Route path="/" element={<Navigate to="/portal/overview" replace />} />
      <Route path="/portal" element={<Navigate to="/portal/overview" replace />} />
      <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
      <Route path="*" element={<Navigate to="/portal/overview" replace />} />
    </Routes>
  );
}
