import { CircleHelp, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatKeys,
  isMacPlatform,
  shortcutLabel,
  shortcutsByCategory,
} from "../lib/shortcuts";
import { LogoSymbol } from "./ui/logo-symbol";
import { Tooltip } from "./ui/tooltip";

const SUPPORTED_FORMATS: ReadonlyArray<{
  readonly ext: string;
  readonly note: string;
}> = [
  { ext: ".hwp", note: "한글 5.0 바이너리 (내부적으로 HWPX 변환 후 처리)" },
  { ext: ".hwpx", note: "한글 표준 문서 — 표·이미지·체크박스 기호 지원" },
  { ext: ".docx", note: "MS Word 문서" },
  { ext: ".pdf", note: "PDF 문서 (텍스트 기반)" },
  { ext: ".html", note: "로컬 HTML 파일 및 웹 페이지 URL (본문 자동 추출)" },
  { ext: ".md", note: "Markdown — 변환 없이 바로 열어 편집" },
];

const EDIT_MODES: ReadonlyArray<{
  readonly name: string;
  readonly note: string;
}> = [
  { name: "보기", note: "변환 결과를 렌더링된 문서로 확인" },
  { name: "편집", note: "WYSIWYG 편집 (워드처럼 서식을 보며 수정)" },
  { name: "소스", note: "Markdown 원문을 직접 편집" },
  { name: "분할", note: "소스와 미리보기를 좌우로 동시에 표시" },
];

interface KeyLike {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

function matchesHelpShortcut(event: KeyLike): boolean {
  if (event.key === "F1") return true;
  return (event.metaKey || event.ctrlKey) && event.key === "/";
}

/** 에디터 등 입력 요소에 포커스가 있으면 true (use-panel-shortcuts와 동일 기준) */
function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

function SectionTitle({ children }: { readonly children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-[22px] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)] first:mt-0">
      {children}
    </h3>
  );
}

/** 도움말 본문 공통 kbd 스타일 */
function Kbd({ children }: { readonly children: React.ReactNode }) {
  return (
    <kbd className="rounded-[5px] border border-[var(--color-border)] bg-[var(--color-kbd-bg)] px-[7px] py-0.5 font-sans text-[11.5px] text-[var(--color-text-secondary)]">
      {children}
    </kbd>
  );
}

function ShortcutTable() {
  const isMac = isMacPlatform();
  return (
    <div className="flex flex-col gap-3">
      {shortcutsByCategory().map(({ category, items }) => (
        <div key={category}>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            {category}
          </p>
          <table className="w-full text-[13px]">
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[var(--color-table-row-border)] last:border-0"
                >
                  <td className="py-[5px] pr-2">{item.description}</td>
                  <td className="w-40 py-[5px] text-right">
                    <Kbd>{formatKeys(item.keys, isMac)}</Kbd>
                    {item.altKeys && (
                      <span className="ml-1 inline-block">
                        <Kbd>{formatKeys(item.altKeys, isMac)}</Kbd>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function HelpContent() {
  const isMac = isMacPlatform();
  const modClick = formatKeys(["Mod"], isMac);
  return (
    <div className="text-[13.5px] leading-[1.65] text-[var(--color-text)]">
      <SectionTitle>빠른 시작</SectionTitle>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          문서를 창에 <strong>드래그 앤 드롭</strong>하거나 좌측 상단
          버튼(파일·폴더·URL)으로 추가합니다. 폴더를 끌어오면 하위 문서를 모두
          찾아 트리로 표시합니다.
        </li>
        <li>
          <strong>변환</strong> 버튼을 누르면 대기 중인 파일이 일괄 변환됩니다.
          체크박스로 일부만 골라 변환할 수도 있습니다.
        </li>
        <li>
          우측 결과 패널에서 Markdown을 확인·편집하고{" "}
          <Kbd>{shortcutLabel("save", isMac)}</Kbd>로 저장합니다.
        </li>
      </ol>

      <SectionTitle>지원 형식</SectionTitle>
      <table className="w-full text-[13px]">
        <tbody>
          {SUPPORTED_FORMATS.map((format) => (
            <tr
              key={format.ext}
              className="border-b border-[var(--color-table-row-border)] last:border-0"
            >
              <td className="w-16 py-[5px] pr-2 font-mono text-[11.5px] text-[var(--color-text-secondary)]">
                {format.ext}
              </td>
              <td className="py-[5px] text-[var(--color-muted)]">
                {format.note}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <SectionTitle>파일 목록 조작</SectionTitle>
      <ul className="list-disc space-y-1 pl-5">
        <li>클릭: 해당 파일 하나만 선택해 미리보기·결과 표시</li>
        <li>{modClick}+클릭: 체크 상태 개별 토글 (여러 개 골라 변환)</li>
        <li>Shift+클릭: 마지막 클릭 지점부터 범위 체크</li>
        <li>폴더 체크박스: 폴더 안 문서 전체를 한 번에 선택/해제</li>
        <li>변환 실패 파일은 행의 재시도 버튼 또는 상단 일괄 재시도 사용</li>
      </ul>

      <SectionTitle>편집 모드</SectionTitle>
      <ul className="list-disc space-y-1 pl-5">
        {EDIT_MODES.map((mode) => (
          <li key={mode.name}>
            <strong>{mode.name}</strong> — {mode.note}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[var(--color-muted)]">
        결과 툴바의 <strong>빈 행 정리</strong>는 표에서 내용 없는 행을 일괄
        제거합니다 (정리 취소로 되돌리기 가능).
      </p>

      <SectionTitle>단축키</SectionTitle>
      <ShortcutTable />
    </div>
  );
}

/**
 * 헤더의 도움말 버튼 + 매뉴얼 모달.
 * F1 또는 Cmd/Ctrl+/ 로 열고 닫으며, Esc·배경 클릭으로 닫는다.
 */
export function HelpModal() {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const openModal = useCallback(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    // 열기 전 포커스 위치 복원 (키보드 사용자 문맥 유지)
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  }, []);

  const toggle = open ? close : openModal;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (matchesHelpShortcut(event)) {
        // 에디터 입력 중에는 열지 않음 (CodeMirror의 Cmd+/ 주석 토글 등 보호)
        if (!open && isEditableTarget(event)) return;
        event.preventDefault();
        toggle();
        return;
      }
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, toggle, close]);

  // 모달이 열리면 닫기 버튼에 포커스 (키보드 접근성)
  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  // Tab 포커스를 모달 내부에서 순환 (배경으로 새어나가지 않도록)
  const trapTabFocus = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <>
      <Tooltip content="도움말" shortcut={shortcutLabel("help")}>
        <button
          type="button"
          onClick={toggle}
          aria-label="도움말"
          data-testid="help-toggle"
          className="flex items-center rounded-[6px] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-chip-bg)] hover:text-[var(--color-text)] transition-colors"
        >
          <CircleHelp size={14} />
        </button>
      </Tooltip>
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: 모달 백드롭 클릭 닫기는 표준 패턴. 키보드 닫기는 window Escape 핸들러가 담당
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(16,24,40,0.40)] p-4"
          data-testid="help-backdrop"
          onClick={close}
          role="presentation"
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-modal-title"
            data-testid="help-modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // 모달 내부 포커스 시 앱 전역 단축키(패널 토글 등) 차단.
              // 닫기 키(Esc·F1·Cmd+/)와 Tab 순환만 여기서 직접 처리한다.
              if (e.key === "Escape" || matchesHelpShortcut(e)) {
                e.preventDefault();
                close();
              } else {
                trapTabFocus(e);
              }
              e.stopPropagation();
            }}
            className="flex max-h-[85vh] w-full max-w-[600px] flex-col overflow-hidden rounded-[14px] bg-[var(--color-bg)] shadow-[0_24px_48px_-12px_rgba(16,24,40,0.28)]"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-[22px] py-4">
              <div className="flex items-center gap-2.5">
                <LogoSymbol size={24} />
                <h2 id="help-modal-title" className="text-sm font-semibold">
                  Paper MD Studio 사용 안내
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                aria-label="도움말 닫기"
                data-testid="help-close"
                className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-border)]/50 hover:text-[var(--color-text)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px]">
              <HelpContent />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
