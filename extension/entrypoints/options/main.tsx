import React from "react";
import ReactDOM from "react-dom/client";
import { OptionsApp } from "./OptionsApp";
import "../../assets/main.css";

// Apply dark class before first paint to avoid flash (same as sidepanel).
const stored = localStorage.getItem("theme-preference");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const isDark = stored === "dark" || (stored !== "light" && prefersDark);
document.documentElement.classList.toggle("dark", isDark);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>
);
