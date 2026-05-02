import { WidgetType, type EditorView } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import type { CommentThread, DiffSide } from "./types";
import { CommentThreadCard } from "./CommentThreadCard";

export type CommentWidgetCallbacks = {
  onSubmit: (body: string) => void;
  onDraftChange: (draft: string) => void;
};

/**
 * Block-decoration widget rendering a React comment thread between editor
 * lines. CodeMirror handles measurement; React handles the UI.
 *
 * Lifecycle quirks worth remembering:
 *  - `eq()` controls when CM6 re-uses the existing DOM vs. creating a new
 *    widget. We compare on identity + comment count so the React tree
 *    doesn't get destroyed when adding comments to an existing thread.
 *  - `destroy()` defers `root.unmount()` via queueMicrotask — calling
 *    unmount synchronously inside CodeMirror's view update emits a
 *    React 18+ "reconciliation" warning.
 *  - `ignoreEvent()` returns false so clicks/typing reach the React tree.
 */
export class CommentWidget extends WidgetType {
  private root: Root | null = null;

  constructor(
    readonly thread: CommentThread,
    readonly side: DiffSide,
    readonly callbacks: CommentWidgetCallbacks,
  ) {
    super();
  }

  override toDOM(_view: EditorView): HTMLElement {
    const host = document.createElement("div");
    host.className = "cm-fb-comment-thread";
    host.setAttribute("data-side", this.side);
    host.setAttribute("data-thread-id", this.thread.id);
    this.root = createRoot(host);
    this.root.render(
      // CommentThreadCard is mounted outside the React tree CM6 lives in,
      // so we re-establish a MantineProvider portal to inherit theme tokens.
      <MantineProvider>
        <CommentThreadCard thread={this.thread} callbacks={this.callbacks} />
      </MantineProvider>,
    );
    return host;
  }

  override updateDOM(_dom: HTMLElement, _view: EditorView): boolean {
    // Re-render in place rather than swap DOM — preserves React state.
    if (this.root) {
      this.root.render(
        <MantineProvider>
          <CommentThreadCard thread={this.thread} callbacks={this.callbacks} />
        </MantineProvider>,
      );
      return true;
    }
    return false;
  }

  override destroy(_dom: HTMLElement): void {
    // CodeMirror destroys widgets synchronously during view updates;
    // React 18+ complains if unmount is called inside that scope.
    const root = this.root;
    if (root) {
      queueMicrotask(() => root.unmount());
    }
    this.root = null;
  }

  override eq(other: CommentWidget): boolean {
    return (
      this.thread.id === other.thread.id &&
      this.side === other.side &&
      this.thread.comments.length === other.thread.comments.length &&
      this.thread.draft === other.thread.draft
    );
  }

  override ignoreEvent(): boolean {
    return false;
  }

  /** Block widgets sit between lines so the gutter alignment stays clean. */
  override get estimatedHeight(): number {
    // 80 base + 24 per comment is a reasonable initial estimate; CM6
    // measures real height after first paint.
    return 80 + this.thread.comments.length * 24;
  }
}
