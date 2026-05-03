import React from "react";
import ReactDOM from "react-dom/client";

// Cascade layer ordering MUST be declared first so Mantine's `@layer mantine`
// blocks slot into the right position regardless of subsequent CSS imports.
import "./styles/mantine-layers.css";

// Mantine package CSS (each in `@layer mantine`).
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";

// Existing app styles (loaded into `@layer app` implicitly by being last;
// each file that wants a different layer can declare it locally).
import "./styles/styles.css";
import "./styles/portal-shared.css";
import "./styles/ai-guidance.css";

import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
