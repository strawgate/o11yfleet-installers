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

/**
 * Maximum captured DOM text length passed to the AI guidance request.
 * Long enough to capture a typical page worth of context, short enough
 * that an oversized DOM (e.g. infinite scroll) cannot blow up the
 * request body or the LLM input window.
 */
const MAX_VISIBLE_TEXT_BYTES = 16_384;

/**
 * Redaction patterns applied before any captured DOM text leaves the
 * browser. Anything that looks like a secret/token gets replaced with
 * a placeholder so it never reaches the LLM provider — even if the
 * provider is the o11yfleet-managed one.
 */
const REDACTION_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /Bearer\s+[A-Za-z0-9._\-+/=]+/g, replacement: "Bearer [REDACTED]" },
  { pattern: /--token\s+\S+/g, replacement: "--token [REDACTED]" },
  { pattern: /fp_enroll_[A-Za-z0-9._\-+/=]+/g, replacement: "fp_enroll_[REDACTED]" },
  // Look for assignment-claim-shaped tokens (three base64url segments
  // separated by `.`, like a JWT). A real claim is much longer than 20
  // chars per segment so the threshold is conservative.
  {
    pattern: /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED_TOKEN]",
  },
  // curl install one-liner — collapse the whole pipeline so a token
  // riding inside it is gone too.
  { pattern: /curl[^\n]*\|\s*bash[^\n]*/g, replacement: "[REDACTED_INSTALL_COMMAND]" },
  // Email addresses → `<local>@<domain>` becomes `[REDACTED_EMAIL]@<domain>`
  // so domain-level signals (organization heuristics) stay visible
  // but the local part — usually the actual personal identifier — is
  // hidden.
  {
    pattern: /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    replacement: "[REDACTED_EMAIL]@$2",
  },
];

function redact(input: string): string {
  let out = input;
  for (const { pattern, replacement } of REDACTION_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function readVisibleText(): string {
  if (typeof document === "undefined") return "";
  const root = document.querySelector("main") ?? document.body;
  if (!root) return "";

  // Walk the tree and skip subtrees marked `data-ai-redact` (or
  // `[hidden]`) so individual components can opt their content out
  // of capture without coordinating with this helper.
  const parts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (
          el.hasAttribute("data-ai-redact") ||
          el.hasAttribute("hidden") ||
          el.tagName === "SCRIPT" ||
          el.tagName === "STYLE" ||
          el.tagName === "NOSCRIPT"
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let totalBytes = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? "";
    if (!text) continue;
    if (totalBytes + text.length > MAX_VISIBLE_TEXT_BYTES) {
      parts.push(text.slice(0, MAX_VISIBLE_TEXT_BYTES - totalBytes));
      break;
    }
    parts.push(text);
    totalBytes += text.length;
  }
  return redact(parts.join(" "));
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
