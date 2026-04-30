import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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

export function useRegisterBrowserContext(source: BrowserContextSource | null | undefined) {
  const { register } = useBrowserContextRegistry();
  const sourceRef = useRef(source);
  const signature = useMemo(
    () => (source ? browserContextSourceSignature(source) : "browser-context:none"),
    [source],
  );
  sourceRef.current = source;

  useEffect(() => {
    if (!sourceRef.current) return;
    return register(sourceRef.current);
  }, [register, signature]);
}

function readVisibleText(): string {
  if (typeof document === "undefined") return "";
  const root = document.querySelector("main") ?? document.body;
  return root.textContent ?? "";
}

const functionIdentities = new WeakMap<object, number>();
let nextFunctionIdentity = 1;

function browserContextSourceSignature(source: BrowserContextSource): string {
  return JSON.stringify(source, (_key, value) => {
    if (typeof value === "function") return functionSignature(value as object);
    return value;
  });
}

function functionSignature(value: object): string {
  let id = functionIdentities.get(value);
  if (!id) {
    id = nextFunctionIdentity;
    nextFunctionIdentity += 1;
    functionIdentities.set(value, id);
  }
  return `[function:${id}]`;
}
