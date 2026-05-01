import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { AuthError } from "@/api/client";

function handleGlobalError(error: Error) {
  if (!(error instanceof AuthError)) return;

  queryClient.clear();

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

  const dest = path.startsWith("/admin") ? "/admin/login" : "/login";
  window.history.replaceState({}, "", dest);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export const queryClient = new QueryClient({
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
