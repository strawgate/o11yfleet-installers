import "@mantine/core";
import type { DefaultMantineColor, MantineColorsTuple } from "@mantine/core";

/**
 * Augment Mantine's theme types so our custom palettes (`brand`, `ok`, `warn`,
 * `err`, `info`) are first-class on `theme.colors` and `<Button color="...">`.
 *
 * The union with `DefaultMantineColor` preserves Mantine's built-in palettes
 * AND its `(string & {})` loose-string fallback — so semantic values like
 * `c="dimmed"` and CSS-variable strings continue to typecheck.
 */
declare module "@mantine/core" {
  export interface MantineThemeColorsOverride {
    colors: Record<
      "brand" | "ok" | "warn" | "err" | "info" | DefaultMantineColor,
      MantineColorsTuple
    >;
  }
}
