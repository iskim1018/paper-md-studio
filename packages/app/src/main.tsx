import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { useFileStore } from "./store/file-store";
import "./styles.css";

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__FILE_STORE__ = useFileStore;
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("루트 엘리먼트를 찾을 수 없습니다.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
