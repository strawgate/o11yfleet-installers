import { useCallback } from "react";
import type { IsValidConnection } from "@xyflow/react";
import { isValidPipelineConnection } from "@o11yfleet/core/pipeline";
import type { BuilderNode } from "../types";
import { mapToCoreNode } from "../schema/to-graph";

export function usePipelineConnectionValidation(
  nodeMap: Map<string, BuilderNode>,
): IsValidConnection {
  return useCallback(
    (c) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      const src = nodeMap.get(c.source);
      const tgt = nodeMap.get(c.target);
      if (!src || !tgt) return false;

      return isValidPipelineConnection(mapToCoreNode(src), mapToCoreNode(tgt));
    },
    [nodeMap],
  );
}
