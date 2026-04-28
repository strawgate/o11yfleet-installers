import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, ApiError } from "./api";

export interface User {
  userId: string;
  email: string;
  displayName: string;
  role: "member" | "admin";
  tenantId: string | null;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem("fp-user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: User }>("/auth/me")
      .then(({ user: u }) => {
        setUser(u);
        localStorage.setItem("fp-user", JSON.stringify(u));
      })
      .catch(() => {
        setUser(null);
        localStorage.removeItem("fp-user");
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: u } = await api.post<{ user: User }>("/auth/login", {
      email,
      password,
    });
    setUser(u);
    localStorage.setItem("fp-user", JSON.stringify(u));
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* best-effort */
    }
    setUser(null);
    localStorage.removeItem("fp-user");
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!user)
    return <Navigate to="/admin-login" state={{ from: location }} replace />;
  if (user.role !== "admin") return <Navigate to="/portal/overview" replace />;
  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
    </div>
  );
}

export { ApiError };
