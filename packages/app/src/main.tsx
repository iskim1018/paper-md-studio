import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("루트 엘리먼트를 찾을 수 없습니다.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
