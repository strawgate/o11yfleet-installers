import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { BrowserContextProvider } from "@/ai/browser-context-react";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { ToastProvider } from "@/components/common/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { theme } from "@/theme/theme";
import { queryClient } from "./query-client";

/**
 * Provider stack. Mantine providers are added alongside the existing Tailwind
 * + Radix providers during the migration; both stacks coexist until pages
 * are migrated one-by-one in subsequent PRs.
 *
 * Order (outer → inner):
 *   QueryClient → Mantine → Modals → Notifications (sibling) → existing legacy stack
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <ModalsProvider>
          <Notifications position="top-right" autoClose={4000} />
          <ToastProvider>
            <TooltipProvider>
              <BrowserRouter>
                <BrowserContextProvider>
                  <ErrorBoundary>{children}</ErrorBoundary>
                </BrowserContextProvider>
              </BrowserRouter>
            </TooltipProvider>
          </ToastProvider>
        </ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}
