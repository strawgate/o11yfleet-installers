import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/styles.css";
import "./styles/portal-shared.css";
import "./styles/ai-guidance.css";

const theme = localStorage.getItem("fb-theme") || "dark";
document.documentElement.setAttribute("data-theme", theme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
