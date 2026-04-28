import { useState, useCallback } from "react";

export function useTheme() {
  const [theme, setThemeState] = useState(
    () => document.documentElement.getAttribute("data-theme") || "dark",
  );

  const toggle = useCallback(() => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("fb-theme", next);
    setThemeState(next);
  }, []);

  return { theme, toggle };
}
