import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { NuqsAdapter } from "nuqs/adapters/react-router/v7";
import { BrowserContextProvider } from "@/ai/browser-context-react";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { theme } from "@/theme/theme";
import { queryClient } from "./query-client";
import { ThemeBridge } from "./ThemeBridge";

/**
 * Provider stack.
 *
 * Order (outer → inner):
 *   QueryClient → Mantine → Modals → BrowserRouter → NuqsAdapter
 *   → Notifications (aria-live) → BrowserContextProvider → ErrorBoundary
 *
 * `<Notifications>` lives INSIDE `<BrowserRouter>` so future notification
 * actions (e.g. an inline "Go to settings" button) can call `useNavigate`
 * without throwing. Notifications themselves don't navigate today, but the
 * ordering keeps that option open without a future provider-tree refactor.
 *
 * `<NuqsAdapter>` (#786) sits inside `<BrowserRouter>` because Nuqs reads
 * router state via `react-router` hooks. The `/v7` adapter is mandatory for
 * RR v7; the bare `nuqs/adapters/react-router` import is deprecated.
 *
 * `<Notifications>` extends ElementProps<'div'>, so the aria-live attribute
 * applies to the rendered notifications container. Without aria-live the
 * toasts mount silently for screen-reader users — same C4 a11y guarantee
 * the legacy ToastProvider provided via its .toaster div.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <ThemeBridge />
        <ModalsProvider>
          <BrowserRouter>
            <NuqsAdapter>
              <Notifications
                position="top-right"
                autoClose={4000}
                role="region"
                aria-label="Notifications"
                aria-live="polite"
                aria-atomic="false"
              />
              <BrowserContextProvider>
                <ErrorBoundary>{children}</ErrorBoundary>
              </BrowserContextProvider>
            </NuqsAdapter>
          </BrowserRouter>
        </ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}
