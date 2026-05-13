import { Fragment, type ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { DropOverlay } from "./components/drop-overlay";
import { FileListPanel } from "./components/file-list-panel";
import { FullscreenToggle } from "./components/fullscreen-toggle";
import { PanelToggles } from "./components/panel-toggles";
import { PreviewPanel } from "./components/preview-panel";
import { ResultPanel } from "./components/result-panel";
import { ThemeToggle } from "./components/theme-toggle";
import { useAutoLoadMarkdown } from "./hooks/use-auto-load-markdown";
import { usePanelShortcuts } from "./hooks/use-panel-shortcuts";
import { useLayoutStore } from "./store/layout-store";

interface PanelDef {
  readonly id: string;
  readonly order: number;
  readonly defaultSize: number;
  readonly minSize: number;
  readonly node: ReactNode;
}

export function App() {
  usePanelShortcuts();
  useAutoLoadMarkdown();

  const isFullscreen = useLayoutStore((s) => s.isResultFullscreen);
  const showFileList = useLayoutStore((s) => s.showFileList);
  const showPreview = useLayoutStore((s) => s.showPreview);
  const showResult = useLayoutStore((s) => s.showResult);

  return (
    <div className="flex h-screen flex-col" data-testid="app-root">
      <DropOverlay />
      <header
        className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4"
        data-testid="app-header"
      >
        <h1 className="text-sm font-semibold">Paper MD Studio</h1>
        <div className="flex items-center gap-2">
          <PanelToggles />
          <span className="h-4 w-px bg-[var(--color-border)]" aria-hidden />
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
        <ResizableLayout
          showFileList={showFileList}
          showPreview={showPreview}
          showResult={showResult}
        />
      )}
    </div>
  );
}

interface ResizableLayoutProps {
  readonly showFileList: boolean;
  readonly showPreview: boolean;
  readonly showResult: boolean;
}

function ResizableLayout({
  showFileList,
  showPreview,
  showResult,
}: ResizableLayoutProps) {
  const panels: Array<PanelDef> = [];
  if (showFileList) {
    panels.push({
      id: "filelist",
      order: 1,
      defaultSize: 25,
      minSize: 15,
      node: <FileListPanel />,
    });
  }
  if (showPreview) {
    panels.push({
      id: "preview",
      order: 2,
      defaultSize: 37,
      minSize: 20,
      node: <PreviewPanel />,
    });
  }
  if (showResult) {
    panels.push({
      id: "result",
      order: 3,
      defaultSize: 38,
      minSize: 20,
      node: <ResultPanel />,
    });
  }

  // 패널이 0개면 invariant 위반 — 호출 측에서 막아야 하지만 안전장치
  if (panels.length === 0) {
    return null;
  }

  // PanelGroup의 autoSaveId로 사용자 manual resize 비율 보존.
  // 보이는 패널 조합이 바뀌면 autoSaveId도 바뀌어 새 비율이 따로 저장됨.
  const autoSaveId = `paper-md-studio:panels:${panels.map((p) => p.id).join("-")}`;

  return (
    <PanelGroup
      direction="horizontal"
      className="flex-1"
      autoSaveId={autoSaveId}
    >
      {panels.map((panel, idx) => (
        <Fragment key={panel.id}>
          {idx > 0 && (
            <PanelResizeHandle className="w-1 bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors" />
          )}
          <Panel
            id={panel.id}
            order={panel.order}
            defaultSize={panel.defaultSize}
            minSize={panel.minSize}
          >
            {panel.node}
          </Panel>
        </Fragment>
      ))}
    </PanelGroup>
  );
}
