import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { BrowserContextProvider } from "@/ai/browser-context-react";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { theme } from "@/theme/theme";
import { queryClient } from "./query-client";

/**
 * Provider stack.
 *
 * Order (outer → inner):
 *   QueryClient → Mantine → Modals → BrowserRouter → Notifications (aria-live)
 *   → BrowserContextProvider → ErrorBoundary
 *
 * `<Notifications>` lives INSIDE `<BrowserRouter>` so future notification
 * actions (e.g. an inline "Go to settings" button) can call `useNavigate`
 * without throwing. Notifications themselves don't navigate today, but the
 * ordering keeps that option open without a future provider-tree refactor.
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
        <ModalsProvider>
          <BrowserRouter>
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
          </BrowserRouter>
        </ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}
