import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { CommentWidget, type CommentWidgetCallbacks } from "./CommentWidget";
import type { CommentThread, DiffSide } from "./types";

/**
 * StateEffect for replacing the entire thread set on a side. Using a
 * full-set replace (vs incremental add/remove effects) keeps reconciliation
 * trivial; the parent React tree owns the canonical thread list and pushes
 * snapshots into the editor on update.
 */
export const setThreads = StateEffect.define<CommentThread[]>();

/**
 * Build the StateField holding the current DecorationSet of thread widgets.
 * One field per side; the call site instantiates two and attaches one to
 * each MergeView pane.
 */
export function commentField(opts: {
  side: DiffSide;
  initial: CommentThread[];
  buildCallbacks: (thread: CommentThread) => CommentWidgetCallbacks;
}) {
  const { side, initial, buildCallbacks } = opts;

  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, initial, side, buildCallbacks);
    },
    update(deco, tr) {
      // Crucial: deco.map carries existing decorations through doc edits so
      // a thread anchored at line 5 follows its line if you insert above it.
      let next = deco.map(tr.changes);
      for (const e of tr.effects) {
        if (e.is(setThreads)) {
          next = buildDecorations(tr.state, e.value, side, buildCallbacks);
        }
      }
      return next;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

function buildDecorations(
  state: { doc: { line: (n: number) => { from: number; to: number } } },
  threads: CommentThread[],
  side: DiffSide,
  buildCallbacks: (thread: CommentThread) => CommentWidgetCallbacks,
): DecorationSet {
  const sorted = threads.filter((t) => t.side === side).sort((a, b) => a.line - b.line);
  const builder = new RangeSetBuilder<Decoration>();
  for (const thread of sorted) {
    let line: { from: number; to: number };
    try {
      line = state.doc.line(thread.line);
    } catch {
      // Out-of-range line numbers (e.g., after a major edit) — skip rather
      // than crash. The caller is responsible for re-anchoring stale threads.
      continue;
    }
    builder.add(
      line.to,
      line.to,
      Decoration.widget({
        widget: new CommentWidget(thread, side, buildCallbacks(thread)),
        block: true,
        side: 1,
      }),
    );
  }
  return builder.finish();
}
