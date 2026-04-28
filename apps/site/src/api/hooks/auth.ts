import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, login as doLogin, logout as doLogout } from "../client";
import type { User } from "../client";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface AuthMeResponse {
  user: User;
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                             */
/* ------------------------------------------------------------------ */

/** Current user session — calls GET /auth/me */
export function useAuth() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => apiGet<AuthMeResponse>("/auth/me"),
    retry: false,
    staleTime: 5 * 60_000,
  });

  return {
    user: data?.user ?? null,
    isLoading,
    isAdmin: data?.user?.role === "admin",
    error,
  };
}

/** Login mutation — POST /auth/login */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      doLogin(email, password),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

/** Logout mutation — POST /auth/logout */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => doLogout(),
    onSuccess: () => {
      qc.clear();
    },
  });
}
