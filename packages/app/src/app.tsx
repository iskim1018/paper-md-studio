import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { DropOverlay } from "./components/drop-overlay";
import { FileListPanel } from "./components/file-list-panel";
import { PreviewPanel } from "./components/preview-panel";
import { ResultPanel } from "./components/result-panel";

export function App() {
  return (
    <div className="flex h-screen flex-col">
      <DropOverlay />
      <header className="flex h-12 shrink-0 items-center border-b border-[var(--color-border)] px-4">
        <h1 className="text-sm font-semibold">docs-to-md</h1>
      </header>
      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={25} minSize={15}>
          <FileListPanel />
        </Panel>
        <PanelResizeHandle className="w-1 bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors" />
        <Panel defaultSize={37} minSize={20}>
          <PreviewPanel />
        </Panel>
        <PanelResizeHandle className="w-1 bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors" />
        <Panel defaultSize={38} minSize={20}>
          <ResultPanel />
        </Panel>
      </PanelGroup>
    </div>
  );
}
