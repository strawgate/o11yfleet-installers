import { Box, useComputedColorScheme } from "@mantine/core";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import type { ConfigDiffViewerProps } from "./types";
import "./diff-viewer.css";

/**
 * Side-by-side YAML diff viewer using react-diff-viewer-continued.
 *
 * Lazy-loaded to keep it out of the main bundle — it only loads when
 * visiting the versions tab or playground.
 */
export default function ConfigDiffViewer(props: ConfigDiffViewerProps) {
  const { left, right, height = 600 } = props;
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";

  return (
    <Box className="rdiff-host" style={{ height, overflow: "auto" }}>
      <ReactDiffViewer
        oldValue={left}
        newValue={right}
        splitView={true}
        showDiffOnly={true}
        useDarkTheme={isDark}
        extraLinesSurroundingDiff={3}
        compareMethod={DiffMethod.LINES}
        disableWordDiff={true}
      />
    </Box>
  );
}
