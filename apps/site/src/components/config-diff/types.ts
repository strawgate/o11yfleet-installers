/**
 * Public types for the config diff viewer.
 */

export type ConfigDiffViewerProps = {
  /** Left-hand YAML (older / from). */
  left: string;
  /** Right-hand YAML (newer / to). */
  right: string;
  /** Total height for the diff pane. */
  height?: number;
};
