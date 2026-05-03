import { useEffect } from "react";
import { useComputedColorScheme } from "@mantine/core";

export function ThemeBridge() {
  const scheme = useComputedColorScheme("dark", { getInitialValueInEffect: false });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", scheme);
  }, [scheme]);
  return null;
}
