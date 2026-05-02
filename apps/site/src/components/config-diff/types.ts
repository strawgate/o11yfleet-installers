/**
 * Public types for the config diff viewer. Imported by pages and the
 * playground; the full editor lives in a lazy chunk.
 */

export type DiffSide = "a" | "b";

export type Comment = {
  id: string;
  author: string;
  body: string;
  /** ISO 8601. */
  createdAt: string;
};

export type CommentThread = {
  id: string;
  side: DiffSide;
  /** 1-indexed CodeMirror line number. */
  line: number;
  comments: Comment[];
  /** Optional draft state — present while the user is composing. */
  draft?: string;
};

export type ConfigDiffViewerProps = {
  /** Left-hand YAML (older / from). */
  left: string;
  /** Right-hand YAML (newer / to). */
  right: string;
  /** Existing comment threads, anchored by side+line. */
  threads?: CommentThread[];
  /** Fired when the user clicks the "+" gutter on a line with no thread. */
  onAddThread?: (side: DiffSide, line: number) => void;
  /** Fired when a thread's draft changes (for caller-controlled persistence). */
  onDraftChange?: (threadId: string, draft: string) => void;
  /** Fired when the user submits a thread draft. */
  onSubmitComment?: (threadId: string, body: string) => void;
  /** Total height for the editor pane. */
  height?: number;
};
