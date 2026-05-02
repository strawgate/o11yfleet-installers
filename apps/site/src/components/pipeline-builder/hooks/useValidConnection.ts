import { useCallback } from "react";
import type { IsValidConnection } from "@xyflow/react";
import type { BuilderNode, BuilderRole } from "../types";

/**
 * OTel role + signal validity rules:
 *
 *   receiver  → processor | exporter | connector
 *   processor → processor | exporter | connector
 *   connector → processor | exporter | connector
 *   exporter  → (sink, no outgoing)
 *
 * Plus: source.signals must overlap target.signals — you can't pipe a
 * logs-only receiver into a metrics-only exporter.
 */

const ROLE_MATRIX: Record<BuilderRole, BuilderRole[]> = {
  receiver: ["processor", "exporter", "connector"],
  processor: ["processor", "exporter", "connector"],
  connector: ["processor", "exporter", "connector"],
  exporter: [],
};

export function useValidConnection(nodeMap: Map<string, BuilderNode>): IsValidConnection {
  return useCallback(
    (c) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      const src = nodeMap.get(c.source);
      const tgt = nodeMap.get(c.target);
      if (!src || !tgt) return false;
      const srcRole = src.type as BuilderRole | undefined;
      const tgtRole = tgt.type as BuilderRole | undefined;
      if (!srcRole || !tgtRole) return false;
      if (!ROLE_MATRIX[srcRole].includes(tgtRole)) return false;
      const srcSignals = src.data.signals;
      const tgtSignals = tgt.data.signals;
      return srcSignals.some((s) => tgtSignals.includes(s));
    },
    [nodeMap],
  );
}

export { ROLE_MATRIX };
