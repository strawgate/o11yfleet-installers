import { EditorView } from "@codemirror/view";

/**
 * Mantine ↔ CodeMirror theme bridge. Targets CSS variables on the
 * document root rather than fixed hex values so a future palette tweak
 * propagates into the editor without code changes.
 */
export function mantineCmTheme(scheme: "light" | "dark") {
  return EditorView.theme(
    {
      "&": {
        backgroundColor: "var(--mantine-color-body)",
        color: "var(--mantine-color-text)",
        fontFamily: "var(--mantine-font-family-monospace)",
        fontSize: "13px",
      },
      ".cm-scroller": {
        fontFamily: "var(--mantine-font-family-monospace)",
      },
      ".cm-gutters": {
        backgroundColor:
          scheme === "dark" ? "var(--mantine-color-dark-7)" : "var(--mantine-color-gray-0)",
        color: "var(--mantine-color-dimmed)",
        borderRight: "1px solid var(--mantine-color-default-border)",
      },
      ".cm-activeLineGutter, .cm-activeLine": {
        backgroundColor: "var(--mantine-color-default-hover)",
      },
      // CodeMirror Merge gutter classes
      ".cm-changedLine": {
        backgroundColor:
          scheme === "dark" ? "rgba(250, 200, 100, 0.08)" : "rgba(250, 180, 80, 0.18)",
      },
      ".cm-deletedLine, .cm-deletedChunk": {
        backgroundColor:
          scheme === "dark" ? "rgba(248, 113, 113, 0.12)" : "var(--mantine-color-red-1)",
      },
      ".cm-insertedLine": {
        backgroundColor:
          scheme === "dark" ? "rgba(74, 222, 128, 0.12)" : "var(--mantine-color-green-1)",
      },
      ".cm-fb-comment-thread": {
        margin: "4px 0",
      },
    },
    { dark: scheme === "dark" },
  );
}
