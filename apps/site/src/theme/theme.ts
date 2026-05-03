import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Brand: oklch hue 152° (lime green) — matches existing --accent in styles.css
const brand: MantineColorsTuple = [
  "oklch(0.97 0.02 152)",
  "oklch(0.93 0.05 152)",
  "oklch(0.87 0.09 152)",
  "oklch(0.80 0.13 152)",
  "oklch(0.73 0.16 152)",
  "oklch(0.65 0.17 152)", // primary (light)
  "oklch(0.55 0.17 152)",
  "oklch(0.45 0.16 152)",
  "oklch(0.35 0.13 152)",
  "oklch(0.25 0.10 152)",
];

// Neutral gray ramp — matches the existing --bg/--fg progression in styles.css
const gray: MantineColorsTuple = [
  "#fbfbfa",
  "#f6f6f4",
  "#ececea",
  "#e0e0dd",
  "#c8c8c4",
  "#8a909c",
  "#5b6271",
  "#2c2f36",
  "#11141a",
  "#08090b",
];

// Status hues — derived from existing oklch values in styles.css
const ok: MantineColorsTuple = brand;

const warn: MantineColorsTuple = [
  "oklch(0.97 0.03 78)",
  "oklch(0.93 0.06 78)",
  "oklch(0.88 0.09 78)",
  "oklch(0.84 0.11 78)",
  "oklch(0.82 0.13 78)", // matches --warn dark
  "oklch(0.74 0.13 78)",
  "oklch(0.65 0.12 78)",
  "oklch(0.55 0.11 78)",
  "oklch(0.42 0.09 78)",
  "oklch(0.30 0.07 78)",
];

const err: MantineColorsTuple = [
  "oklch(0.97 0.02 24)",
  "oklch(0.93 0.06 24)",
  "oklch(0.86 0.10 24)",
  "oklch(0.78 0.14 24)",
  "oklch(0.74 0.16 24)",
  "oklch(0.70 0.18 24)", // matches --err dark
  "oklch(0.62 0.18 24)",
  "oklch(0.50 0.17 24)",
  "oklch(0.40 0.14 24)",
  "oklch(0.28 0.10 24)",
];

const info: MantineColorsTuple = [
  "oklch(0.97 0.02 230)",
  "oklch(0.93 0.04 230)",
  "oklch(0.87 0.06 230)",
  "oklch(0.80 0.08 230)",
  "oklch(0.76 0.09 230)",
  "oklch(0.72 0.10 230)", // matches --info dark
  "oklch(0.62 0.10 230)",
  "oklch(0.50 0.09 230)",
  "oklch(0.38 0.07 230)",
  "oklch(0.26 0.05 230)",
];

export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: { light: 6, dark: 5 },
  defaultRadius: "md",
  fontFamily: 'Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  fontFamilyMonospace: 'Geist Mono, ui-monospace, JetBrains Mono, "Fira Code", Menlo, monospace',
  colors: { brand, gray, ok, warn, err, info },
  cursorType: "pointer",
  autoContrast: true,
  components: {
    // Buttons inside `<PageHeader>` actions, modal footers, and inline tables
    // default to `size="sm"`. Override per-call with `size="xs"` for dense
    // toolbars or `size="md"` for primary CTAs on landing pages.
    Button: { defaultProps: { size: "sm" } },
    // Cards default to bordered with no shadow — matches dev-doc guidance
    // and the patterns we see across mantine.dev and the analytics dashboard.
    Card: { defaultProps: { withBorder: true, radius: "md" } },
    // Badges in `light` variant are the de-facto status pill across
    // app primitives (StatusBadge etc.); make that the default everywhere.
    Badge: { defaultProps: { variant: "light" } },
    // Modal: centered + autofocus trap return + close-on-escape are all
    // already Mantine defaults. The wrapper at common/Modal sets these
    // explicitly; keep the theme aligned so direct `<Modal>` use matches.
    Modal: { defaultProps: { centered: true } },
  },
});
