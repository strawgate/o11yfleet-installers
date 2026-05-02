import { useEffect, useMemo, useRef } from "react";
import { Box, useComputedColorScheme } from "@mantine/core";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml";
import { MergeView } from "@codemirror/merge";
import { commentField, setThreads } from "./comment-extension";
import { mantineCmTheme } from "./theme-bridge";
import type { CommentThread, ConfigDiffViewerProps, DiffSide } from "./types";
import "./diff-viewer.css";

/**
 * Side-by-side YAML diff with line-anchored React comment widgets.
 *
 * Why this is a default-export from a lazy-loaded module:
 *   CodeMirror 6 + merge + yaml is ~170-220 KB gz, only useful on the
 *   versions tab + dev playground. Pages import via
 *   `lazy(() => import("@/components/config-diff/ConfigDiffViewer"))`.
 */
export default function ConfigDiffViewer(props: ConfigDiffViewerProps) {
  const {
    left,
    right,
    threads = [],
    onAddThread,
    onSubmitComment,
    onDraftChange,
    height = 600,
  } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const fieldsRef = useRef<{
    a: ReturnType<typeof commentField>;
    b: ReturnType<typeof commentField>;
  } | null>(null);

  const scheme = useComputedColorScheme("dark");

  // Stash the latest callback refs so we don't reinit the editor when they change.
  const callbacksRef = useRef({ onAddThread, onSubmitComment, onDraftChange });
  callbacksRef.current = { onAddThread, onSubmitComment, onDraftChange };

  const themeExt = useMemo(() => mantineCmTheme(scheme), [scheme]);

  // Build extensions only when the theme/structure changes; threads are
  // pushed in via setThreads effects below.
  useEffect(() => {
    if (!hostRef.current) return;

    const buildCallbacksFor = (thread: CommentThread) => ({
      onSubmit: (body: string) => callbacksRef.current.onSubmitComment?.(thread.id, body),
      onDraftChange: (draft: string) => callbacksRef.current.onDraftChange?.(thread.id, draft),
    });

    const fieldA = commentField({
      side: "a",
      initial: threads,
      buildCallbacks: buildCallbacksFor,
    });
    const fieldB = commentField({
      side: "b",
      initial: threads,
      buildCallbacks: buildCallbacksFor,
    });
    fieldsRef.current = { a: fieldA, b: fieldB };

    const baseExt = (side: DiffSide) => [
      lineNumbers(),
      yaml(),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      themeExt,
      side === "a" ? fieldA : fieldB,
      EditorView.domEventHandlers({
        click: (e, view) => {
          if (!callbacksRef.current.onAddThread) return false;
          // Use alt-click as the v1 surface for adding a thread; a custom
          // gutter widget with a "+" button is a follow-up enhancement.
          if (!e.altKey) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos === null || pos === undefined) return false;
          const line = view.state.doc.lineAt(pos).number;
          callbacksRef.current.onAddThread(side, line);
          return true;
        },
      }),
    ];

    const view = new MergeView({
      a: { doc: left, extensions: baseExt("a") },
      b: { doc: right, extensions: baseExt("b") },
      parent: hostRef.current,
      revertControls: undefined,
      highlightChanges: true,
      gutter: true,
    });
    mergeRef.current = view;

    return () => {
      view.destroy();
      mergeRef.current = null;
      fieldsRef.current = null;
    };
    // Heavy re-init only on theme + doc identity. Threads sync via effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, right, themeExt]);

  // Push thread updates without re-creating the editor.
  useEffect(() => {
    const merge = mergeRef.current;
    if (!merge) return;
    merge.a.dispatch({ effects: setThreads.of(threads) });
    merge.b.dispatch({ effects: setThreads.of(threads) });
  }, [threads]);

  return <Box ref={hostRef} className="cm-fb-diff-host" style={{ height }} />;
}
