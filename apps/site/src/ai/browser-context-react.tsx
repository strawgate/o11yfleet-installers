import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  mergeBrowserContextSources,
  type BrowserContextSnapshot,
  type BrowserContextSource,
} from "./browser-context";

interface BrowserContextRegistry {
  capture: (pathname: string) => BrowserContextSnapshot;
  register: (source: BrowserContextSource) => () => void;
}

const BrowserContext = createContext<BrowserContextRegistry | null>(null);

export function BrowserContextProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<BrowserContextSource[]>([]);

  const register = useCallback((source: BrowserContextSource) => {
    setSources((current) => [...current.filter((item) => item.id !== source.id), source]);
    return () => {
      setSources((current) => current.filter((item) => item.id !== source.id));
    };
  }, []);

  const capture = useCallback(
    (pathname: string) => {
      return mergeBrowserContextSources(pathname, readVisibleText(), sources);
    },
    [sources],
  );

  const value = useMemo(() => ({ capture, register }), [capture, register]);

  return <BrowserContext.Provider value={value}>{children}</BrowserContext.Provider>;
}

export function useBrowserContextRegistry() {
  const registry = useContext(BrowserContext);
  if (!registry) {
    throw new Error("useBrowserContextRegistry must be used inside BrowserContextProvider");
  }
  return registry;
}

export function useRegisterBrowserContext(source: BrowserContextSource) {
  const { register } = useBrowserContextRegistry();

  useEffect(() => register(source), [register, source]);
}

function readVisibleText(): string {
  if (typeof document === "undefined") return "";
  const root = document.querySelector("main") ?? document.body;
  return root.textContent ?? "";
}
