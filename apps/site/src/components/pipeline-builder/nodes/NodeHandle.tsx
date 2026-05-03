import { Handle, type HandleProps } from "@xyflow/react";
import classes from "./node.module.css";

/**
 * Common wrapper for React Flow <Handle> ensuring consistent styling
 * and functionality across all pipeline node types.
 */
export function NodeHandle(props: HandleProps) {
  return <Handle {...props} className={`${classes["handle"]} ${props.className || ""}`} />;
}
