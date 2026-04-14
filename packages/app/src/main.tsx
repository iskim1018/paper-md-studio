import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { useConvertQueueStore } from "./store/convert-queue-store";
import { useFileStore } from "./store/file-store";
import { useSettingsStore } from "./store/settings-store";
import "./styles.css";

if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w.__FILE_STORE__ = useFileStore;
  w.__QUEUE_STORE__ = useConvertQueueStore;
  w.__SETTINGS_STORE__ = useSettingsStore;
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
