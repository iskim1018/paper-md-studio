import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { DropOverlay } from "./components/drop-overlay";
import { FileListPanel } from "./components/file-list-panel";
import { FullscreenToggle } from "./components/fullscreen-toggle";
import { PreviewPanel } from "./components/preview-panel";
import { ResultPanel } from "./components/result-panel";
import { ThemeToggle } from "./components/theme-toggle";
import { useLayoutStore } from "./store/layout-store";

export function App() {
  const isFullscreen = useLayoutStore((s) => s.isResultFullscreen);

  return (
    <div className="flex h-screen flex-col" data-testid="app-root">
      <DropOverlay />
      <header
        className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4"
        data-testid="app-header"
      >
        <h1 className="text-sm font-semibold">docs-to-md</h1>
        <div className="flex items-center gap-1">
          <FullscreenToggle />
          <ThemeToggle />
        </div>
      </header>
      {isFullscreen ? (
        <div
          className="min-h-0 flex-1 overflow-hidden"
          data-testid="fullscreen-result"
        >
          <ResultPanel />
        </div>
      ) : (
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
      )}
    </div>
  );
}
