import { create } from "zustand";
import { ConvertQueue, type QueueSnapshot } from "../lib/convert-queue";
import { convertFile } from "../lib/converter";
import { useFileStore } from "./file-store";
import { useSettingsStore } from "./settings-store";

const DEFAULT_CONCURRENCY = 5;

interface QueueItem {
  readonly id: string;
  readonly path: string;
}

interface ConvertQueueStore extends QueueSnapshot {
  readonly active: boolean;
  startBatch: (items: ReadonlyArray<QueueItem>) => void;
  retry: (item: QueueItem) => void;
  cancelAll: () => void;
}

const fileStore = useFileStore;

async function runItem(item: QueueItem): Promise<void> {
  const { updateFile } = fileStore.getState();
  updateFile(item.id, { status: "converting" });
  try {
    const outputDir = useSettingsStore.getState().outputDir;
    const result = await convertFile(item.path, { outputDir });
    updateFile(item.id, { status: "done", result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "변환 실패";
    updateFile(item.id, { status: "error", error: message });
    throw err;
  }
}

const queue = new ConvertQueue<QueueItem>({
  concurrency: DEFAULT_CONCURRENCY,
  run: runItem,
  onProgress: (snap) => {
    useConvertQueueStore.setState({
      ...snap,
      active: snap.running > 0 || snap.pending > 0,
    });
  },
  onIdle: () => {
    useConvertQueueStore.setState({ active: false });
  },
});

export const useConvertQueueStore = create<ConvertQueueStore>(() => ({
  running: 0,
  pending: 0,
  completed: 0,
  failed: 0,
  active: false,

  startBatch: (items) => {
    if (items.length === 0) return;
    queue.resetStats();
    for (const item of items) queue.enqueue(item);
  },

  retry: (item) => {
    queue.enqueue(item);
  },

  cancelAll: () => {
    queue.cancelAll();
  },
}));
