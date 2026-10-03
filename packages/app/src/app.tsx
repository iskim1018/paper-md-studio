import { Fragment, type ReactNode } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { DropOverlay } from "./components/drop-overlay";
import { FileListPanel } from "./components/file-list-panel";
import { FullscreenToggle } from "./components/fullscreen-toggle";
import { HelpModal } from "./components/help-modal";
import { PanelToggles } from "./components/panel-toggles";
import { PreviewPanel } from "./components/preview-panel";
import { ResultPanel } from "./components/result-panel";
import { ThemeToggle } from "./components/theme-toggle";
import { LogoSymbol } from "./components/ui/logo-symbol";
import { ResizeHandle } from "./components/ui/resize-handle";
import { UpdateBanner } from "./components/update-banner";
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
        className="flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--color-border)] px-[18px]"
        data-testid="app-header"
      >
        <div className="flex items-center gap-[9px]">
          <LogoSymbol size={26} />
          <h1 className="text-sm font-normal tracking-[-0.01em]">
            <span className="font-bold">Paper</span>{" "}
            <span className="font-extrabold text-[var(--color-success)]">
              MD
            </span>{" "}
            <span className="text-[var(--color-muted)]">Studio</span>
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <PanelToggles />
          <span
            className="mx-1.5 h-4 w-px bg-[var(--color-border)]"
            aria-hidden
          />
          <FullscreenToggle />
          <ThemeToggle />
          <HelpModal />
        </div>
      </header>
      <UpdateBanner />
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

/** 탐색 트리는 이름만 보이면 되므로 좁게, 남는 폭은 두 뷰어가 나눠 갖는다 */
const FILE_LIST_DEFAULT_SIZE = 18;
const FILE_LIST_MIN_SIZE = 12;
const VIEWER_MIN_SIZE = 20;
/**
 * 저장된 패널 비율의 형식 판. 기본 비율을 바꿨을 때 올리면 예전에 저장된 비율
 * 대신 새 기본값이 한 번 적용된다 (v2: 25/37/38 → 18/41/41, 2026-10-03).
 */
const PANEL_LAYOUT_VERSION = 2;

function ResizableLayout({
  showFileList,
  showPreview,
  showResult,
}: ResizableLayoutProps) {
  const viewerCount = Number(showPreview) + Number(showResult);
  const fileListSize =
    viewerCount === 0 ? 100 : showFileList ? FILE_LIST_DEFAULT_SIZE : 0;
  // 보이는 패널의 기본값 합이 늘 100 이 되게 한다 — 아니면 라이브러리가 임의로 보정한다
  const viewerSize = viewerCount === 0 ? 0 : (100 - fileListSize) / viewerCount;

  const panels: Array<PanelDef> = [];
  if (showFileList) {
    panels.push({
      id: "filelist",
      order: 1,
      defaultSize: fileListSize,
      minSize: FILE_LIST_MIN_SIZE,
      node: <FileListPanel />,
    });
  }
  if (showPreview) {
    panels.push({
      id: "preview",
      order: 2,
      defaultSize: viewerSize,
      minSize: VIEWER_MIN_SIZE,
      node: <PreviewPanel />,
    });
  }
  if (showResult) {
    panels.push({
      id: "result",
      order: 3,
      defaultSize: viewerSize,
      minSize: VIEWER_MIN_SIZE,
      node: <ResultPanel />,
    });
  }

  // 패널이 0개면 invariant 위반 — 호출 측에서 막아야 하지만 안전장치
  if (panels.length === 0) {
    return null;
  }

  // PanelGroup의 autoSaveId로 사용자 manual resize 비율 보존.
  // 보이는 패널 조합이 바뀌면 autoSaveId도 바뀌어 새 비율이 따로 저장됨.
  const autoSaveId = `paper-md-studio:panels:v${PANEL_LAYOUT_VERSION}:${panels.map((p) => p.id).join("-")}`;

  return (
    <PanelGroup
      direction="horizontal"
      className="flex-1"
      autoSaveId={autoSaveId}
    >
      {panels.map((panel, idx) => (
        <Fragment key={panel.id}>
          {idx > 0 && <ResizeHandle />}
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
