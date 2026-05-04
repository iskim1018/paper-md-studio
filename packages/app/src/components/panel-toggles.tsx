import { PanelLeft, PanelRight, Square } from "lucide-react";
import { useLayoutStore } from "../store/layout-store";

const SHORTCUT_LEFT = "Cmd/Ctrl+B";
const SHORTCUT_CENTER = "Cmd/Ctrl+Shift+P";
const SHORTCUT_RIGHT = "Cmd/Ctrl+Shift+R";

interface ToggleButtonProps {
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly shortcut: string;
  readonly testId: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}

function ToggleButton({
  active,
  disabled,
  label,
  shortcut,
  testId,
  onClick,
  children,
}: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={`${label} (${shortcut})`}
      data-testid={testId}
      className={`flex items-center rounded p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-20 ${
        active
          ? "bg-[var(--color-border)] text-[var(--color-text)]"
          : "text-[var(--color-muted)] hover:bg-[var(--color-border)]/50 hover:text-[var(--color-text)]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * 헤더 우측의 패널 visibility 토글. 위치 기반 (좌측/중앙/우측)으로 구성.
 *
 * Invariant: 3개 중 최소 1개는 visible이어야 한다 (빈 화면 방지). 마지막 한 개를
 * 끄려는 토글은 disabled 처리.
 */
export function PanelToggles() {
  const showFileList = useLayoutStore((s) => s.showFileList);
  const showPreview = useLayoutStore((s) => s.showPreview);
  const showResult = useLayoutStore((s) => s.showResult);
  const isFullscreen = useLayoutStore((s) => s.isResultFullscreen);
  const toggleFileList = useLayoutStore((s) => s.toggleFileList);
  const togglePreview = useLayoutStore((s) => s.togglePreview);
  const toggleResult = useLayoutStore((s) => s.toggleResult);

  // Result 전체화면 모드에서는 모든 토글 비활성 (전체화면 토글로만 빠져나옴)
  const disableAll = isFullscreen;

  // 마지막 visible 패널을 끄려는 시도는 disable.
  // 다른 둘이 모두 숨김 + 자기가 visible이면 disabled.
  const isLastVisible = (self: boolean, otherA: boolean, otherB: boolean) =>
    self && !otherA && !otherB;

  const disableLeft =
    disableAll || isLastVisible(showFileList, showPreview, showResult);
  const disableCenter =
    disableAll || isLastVisible(showPreview, showFileList, showResult);
  const disableRight =
    disableAll || isLastVisible(showResult, showFileList, showPreview);

  return (
    <div className="flex items-center gap-0.5">
      <ToggleButton
        active={showFileList}
        disabled={disableLeft}
        label="좌측 패널 (파일 목록)"
        shortcut={SHORTCUT_LEFT}
        testId="toggle-filelist"
        onClick={toggleFileList}
      >
        <PanelLeft size={14} />
      </ToggleButton>
      <ToggleButton
        active={showPreview}
        disabled={disableCenter}
        label="중앙 패널 (원본 미리보기)"
        shortcut={SHORTCUT_CENTER}
        testId="toggle-preview"
        onClick={togglePreview}
      >
        <Square size={14} />
      </ToggleButton>
      <ToggleButton
        active={showResult}
        disabled={disableRight}
        label="우측 패널 (변환 결과)"
        shortcut={SHORTCUT_RIGHT}
        testId="toggle-result"
        onClick={toggleResult}
      >
        <PanelRight size={14} />
      </ToggleButton>
    </div>
  );
}
