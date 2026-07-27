// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkMock = vi.fn();
const downloadAndInstallMock = vi.fn();
const relaunchMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: () => checkMock(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: () => relaunchMock(),
}));

import { UpdateBanner } from "../../src/components/update-banner";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  checkMock.mockReset();
  downloadAndInstallMock.mockReset();
  relaunchMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** 시작 지연(3초)을 넘겨 업데이트 확인을 트리거한다. */
async function advancePastCheckDelay(): Promise<void> {
  await vi.advanceTimersByTimeAsync(3100);
}

describe("UpdateBanner", () => {
  it("업데이트가 없으면 아무것도 렌더하지 않는다", async () => {
    checkMock.mockResolvedValue(null);
    render(<UpdateBanner />);

    await advancePastCheckDelay();

    expect(screen.queryByTestId("update-banner")).toBeNull();
  });

  it("업데이터를 쓸 수 없는 환경(웹/개발)에서도 조용히 넘어간다", async () => {
    checkMock.mockRejectedValue(new Error("no tauri runtime"));
    render(<UpdateBanner />);

    await advancePastCheckDelay();

    expect(screen.queryByTestId("update-banner")).toBeNull();
  });

  it("새 버전이 있으면 버전과 설치 버튼을 보여준다", async () => {
    checkMock.mockResolvedValue({
      version: "0.9.9",
      downloadAndInstall: downloadAndInstallMock,
    });
    render(<UpdateBanner />);

    await advancePastCheckDelay();

    await waitFor(() => {
      expect(screen.getByTestId("update-banner")).toBeTruthy();
    });
    expect(screen.getByText("0.9.9", { exact: false })).toBeTruthy();
    expect(screen.getByTestId("update-install-btn")).toBeTruthy();
    // 사용자가 누르기 전에는 절대 설치하지 않는다
    expect(downloadAndInstallMock).not.toHaveBeenCalled();
  });

  it("설치 버튼을 누르면 내려받고 앱을 재시작한다", async () => {
    downloadAndInstallMock.mockImplementation(
      async (onEvent: (e: unknown) => void) => {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 50 } });
        onEvent({ event: "Finished" });
      },
    );
    checkMock.mockResolvedValue({
      version: "0.9.9",
      downloadAndInstall: downloadAndInstallMock,
    });
    render(<UpdateBanner />);
    await advancePastCheckDelay();
    await waitFor(() =>
      expect(screen.getByTestId("update-banner")).toBeTruthy(),
    );

    await userEvent.click(screen.getByTestId("update-install-btn"));

    await waitFor(() => expect(relaunchMock).toHaveBeenCalled());
    expect(downloadAndInstallMock).toHaveBeenCalledTimes(1);
  });

  it("설치에 실패하면 오류를 표시하고 재시작하지 않는다", async () => {
    downloadAndInstallMock.mockRejectedValue(new Error("서명 불일치"));
    checkMock.mockResolvedValue({
      version: "0.9.9",
      downloadAndInstall: downloadAndInstallMock,
    });
    render(<UpdateBanner />);
    await advancePastCheckDelay();
    await waitFor(() =>
      expect(screen.getByTestId("update-banner")).toBeTruthy(),
    );

    await userEvent.click(screen.getByTestId("update-install-btn"));

    await waitFor(() => {
      expect(screen.getByText(/서명 불일치/)).toBeTruthy();
    });
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("닫기 버튼을 누르면 배너가 사라진다", async () => {
    checkMock.mockResolvedValue({
      version: "0.9.9",
      downloadAndInstall: downloadAndInstallMock,
    });
    render(<UpdateBanner />);
    await advancePastCheckDelay();
    await waitFor(() =>
      expect(screen.getByTestId("update-banner")).toBeTruthy(),
    );

    await userEvent.click(screen.getByTestId("update-dismiss-btn"));

    expect(screen.queryByTestId("update-banner")).toBeNull();
  });
});
