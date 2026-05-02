/**
 * Public surface for the config diff viewer. Use the lazy-loaded default
 * export from `./ConfigDiffViewer` to keep CM6 out of the main bundle:
 *
 *   const ConfigDiffViewer = lazy(() => import("@/components/config-diff/ConfigDiffViewer"));
 */

export type { Comment, CommentThread, ConfigDiffViewerProps, DiffSide } from "./types";
