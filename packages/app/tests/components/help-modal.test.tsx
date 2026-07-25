// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { HelpModal } from "../../src/components/help-modal";

afterEach(() => {
  cleanup();
});

describe("HelpModal", () => {
  it("초기에는 모달이 닫혀 있다", () => {
    render(<HelpModal />);
    expect(screen.queryByTestId("help-modal")).toBeNull();
  });

  it("도움말 버튼 클릭으로 열리고 닫기 버튼으로 닫힌다", async () => {
    render(<HelpModal />);
    await userEvent.click(screen.getByTestId("help-toggle"));
    expect(screen.getByTestId("help-modal")).toBeTruthy();
    await userEvent.click(screen.getByTestId("help-close"));
    expect(screen.queryByTestId("help-modal")).toBeNull();
  });

  it("F1 키로 토글된다", () => {
    render(<HelpModal />);
    fireEvent.keyDown(window, { key: "F1" });
    expect(screen.getByTestId("help-modal")).toBeTruthy();
    fireEvent.keyDown(window, { key: "F1" });
    expect(screen.queryByTestId("help-modal")).toBeNull();
  });

  it("Cmd/Ctrl+/ 로 토글된다", () => {
    render(<HelpModal />);
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    expect(screen.getByTestId("help-modal")).toBeTruthy();
    fireEvent.keyDown(window, { key: "/", metaKey: true });
    expect(screen.queryByTestId("help-modal")).toBeNull();
  });

  it("Escape로 닫힌다", () => {
    render(<HelpModal />);
    fireEvent.keyDown(window, { key: "F1" });
    expect(screen.getByTestId("help-modal")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("help-modal")).toBeNull();
  });

  it("배경 클릭으로 닫히지만 모달 내부 클릭은 유지된다", async () => {
    render(<HelpModal />);
    fireEvent.keyDown(window, { key: "F1" });
    await userEvent.click(screen.getByTestId("help-modal"));
    expect(screen.getByTestId("help-modal")).toBeTruthy();
    await userEvent.click(screen.getByTestId("help-backdrop"));
    expect(screen.queryByTestId("help-modal")).toBeNull();
  });

  it("에디터 등 입력 요소에 포커스 중에는 열리지 않는다", () => {
    render(
      <>
        <input data-testid="editor-input" />
        <HelpModal />
      </>,
    );
    const input = screen.getByTestId("editor-input");
    input.focus();
    fireEvent.keyDown(input, { key: "/", metaKey: true });
    expect(screen.queryByTestId("help-modal")).toBeNull();
    fireEvent.keyDown(input, { key: "F1" });
    expect(screen.queryByTestId("help-modal")).toBeNull();
  });

  it("모달 내부에 포커스가 있어도 F1로 닫힌다", () => {
    render(<HelpModal />);
    fireEvent.keyDown(window, { key: "F1" });
    const closeBtn = screen.getByTestId("help-close");
    fireEvent.keyDown(closeBtn, { key: "F1" });
    expect(screen.queryByTestId("help-modal")).toBeNull();
  });

  it("닫으면 열기 전 포커스 요소로 복원된다", async () => {
    render(<HelpModal />);
    const toggleBtn = screen.getByTestId("help-toggle");
    toggleBtn.focus();
    await userEvent.click(toggleBtn);
    expect(document.activeElement).toBe(screen.getByTestId("help-close"));
    fireEvent.keyDown(screen.getByTestId("help-close"), { key: "Escape" });
    expect(document.activeElement).toBe(toggleBtn);
  });

  it("Tab 포커스가 모달 내부에서 순환한다", () => {
    render(<HelpModal />);
    fireEvent.keyDown(window, { key: "F1" });
    const closeBtn = screen.getByTestId("help-close");
    // 모달 내 포커스 가능 요소가 닫기 버튼 하나뿐이므로 Tab이 자기 자신으로 순환
    fireEvent.keyDown(closeBtn, { key: "Tab" });
    expect(document.activeElement).toBe(closeBtn);
    fireEvent.keyDown(closeBtn, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("매뉴얼 핵심 섹션과 단축키 표가 렌더된다", () => {
    render(<HelpModal />);
    fireEvent.keyDown(window, { key: "F1" });
    expect(screen.getByText("빠른 시작")).toBeTruthy();
    expect(screen.getByText("지원 형식")).toBeTruthy();
    expect(screen.getByText("파일 목록 조작")).toBeTruthy();
    expect(screen.getByText("편집 모드")).toBeTruthy();
    expect(screen.getByText("단축키")).toBeTruthy();
    // 단축키 레지스트리 내용이 표에 반영되는지 표본 확인
    expect(screen.getByText("파일 목록 패널 표시/숨김")).toBeTruthy();
    expect(screen.getByText("편집한 Markdown 저장")).toBeTruthy();
  });
});
