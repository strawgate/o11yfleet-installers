import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { BrowserContextProvider } from "@/ai/browser-context-react";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { theme } from "@/theme/theme";
import { queryClient } from "./query-client";

/**
 * Provider stack.
 *
 * Order (outer → inner):
 *   QueryClient → Mantine → Modals → Notifications (aria-live region) →
 *   Tooltip (legacy, used by ai-elements) → Router → ErrorBoundary
 *
 * `<Notifications>` extends ElementProps<'div'>, so the aria-live attribute
 * applies to the rendered notifications container. Without aria-live the
 * toasts mount silently for screen-reader users — same C4 a11y guarantee
 * the legacy ToastProvider provided.
 *
 * `TooltipProvider` is the last surviving shadcn/Radix provider; it stays
 * because the AI copilot's ai-elements primitives import shadcn Tooltip.
 * Removing it requires migrating ai-elements off shadcn first.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <ModalsProvider>
          <Notifications
            position="top-right"
            autoClose={4000}
            role="region"
            aria-label="Notifications"
            aria-live="polite"
            aria-atomic="false"
          />
          <TooltipProvider>
            <BrowserRouter>
              <BrowserContextProvider>
                <ErrorBoundary>{children}</ErrorBoundary>
              </BrowserContextProvider>
            </BrowserRouter>
          </TooltipProvider>
        </ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}
