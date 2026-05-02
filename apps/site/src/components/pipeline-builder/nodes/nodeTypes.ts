import type { NodeTypes } from "@xyflow/react";
import { ReceiverNode } from "./ReceiverNode";
import { ProcessorNode } from "./ProcessorNode";
import { ExporterNode } from "./ExporterNode";
import { ConnectorNode } from "./ConnectorNode";

/**
 * Module-scope registry — required by xyflow. A new identity on every
 * render would trigger a costly remount.
 */
export const nodeTypes: NodeTypes = {
  receiver: ReceiverNode,
  processor: ProcessorNode,
  exporter: ExporterNode,
  connector: ConnectorNode,
};
