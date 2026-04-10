import { expect, test } from "@playwright/test";

/**
 * Zustand 스토어를 통해 파일을 추가하는 헬퍼.
 * Tauri 네이티브 drag-drop은 Playwright에서 직접 테스트 불가하므로
 * 개발 모드에서 window에 노출된 스토어를 사용합니다.
 */
async function addFilesViaStore(
  page: import("@playwright/test").Page,
  paths: Array<string>,
) {
  await page.evaluate((p) => {
    const store = (window as Record<string, unknown>).__FILE_STORE__ as {
      getState: () => { addFiles: (paths: Array<string>) => void };
    };
    store.getState().addFiles(p);
  }, paths);
}

test.describe("파일 상호작용", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("초기 상태에서 파일 수가 0이다", async ({ page }) => {
    const fileCount = page.locator('[data-testid="file-list-panel"]');
    await expect(fileCount).toContainText("파일 (0)");
  });

  test("초기 상태에서 변환 버튼이 없다", async ({ page }) => {
    const convertBtn = page.locator('[data-testid="convert-all-btn"]');
    await expect(convertBtn).toHaveCount(0);
  });

  test("초기 상태에서 초기화 버튼이 없다", async ({ page }) => {
    const clearBtn = page.locator('[data-testid="clear-files-btn"]');
    await expect(clearBtn).toHaveCount(0);
  });

  test("파일을 추가하면 목록에 표시된다", async ({ page }) => {
    await addFilesViaStore(page, ["/tmp/test/문서.hwpx"]);

    const panel = page.locator('[data-testid="file-list-panel"]');
    await expect(panel).toContainText("파일 (1)");
    await expect(panel).toContainText("문서.hwpx");
  });

  test("여러 파일을 추가하면 모두 표시된다", async ({ page }) => {
    await addFilesViaStore(page, ["/tmp/a.hwpx", "/tmp/b.docx", "/tmp/c.pdf"]);

    const panel = page.locator('[data-testid="file-list-panel"]');
    await expect(panel).toContainText("파일 (3)");
    await expect(panel).toContainText("HWPX");
    await expect(panel).toContainText("DOCX");
    await expect(panel).toContainText("PDF");
  });

  test("동일 경로 파일은 중복 추가되지 않는다", async ({ page }) => {
    await addFilesViaStore(page, ["/tmp/test/문서.hwpx"]);
    await addFilesViaStore(page, ["/tmp/test/문서.hwpx"]);

    const panel = page.locator('[data-testid="file-list-panel"]');
    await expect(panel).toContainText("파일 (1)");
  });

  test("파일 추가 후 변환/초기화 버튼이 표시된다", async ({ page }) => {
    await addFilesViaStore(page, ["/tmp/test/문서.hwpx"]);

    await expect(page.locator('[data-testid="convert-all-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="clear-files-btn"]')).toBeVisible();
  });

  test("파일을 선택하면 미리보기 패널에 정보가 표시된다", async ({ page }) => {
    await addFilesViaStore(page, ["/tmp/test/보고서.docx"]);

    // 첫 파일은 자동 선택됨
    const preview = page.locator('[data-testid="preview-panel"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("보고서.docx");
    await expect(preview).toContainText("docx");
    await expect(preview).toContainText("pending");
  });

  test("초기화 버튼으로 모든 파일을 제거한다", async ({ page }) => {
    await addFilesViaStore(page, ["/tmp/a.hwpx", "/tmp/b.docx"]);

    await page.locator('[data-testid="clear-files-btn"]').click();

    const panel = page.locator('[data-testid="file-list-panel"]');
    await expect(panel).toContainText("파일 (0)");
    await expect(page.locator('[data-testid="empty-state"]')).toBeVisible();
  });
});
