import { expect, test } from "@playwright/test";

test.describe("앱 레이아웃", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("앱 헤더가 표시된다", async ({ page }) => {
    const header = page.locator('[data-testid="app-header"]');
    await expect(header).toBeVisible();
    await expect(header).toContainText("Paper MD Studio");
  });

  test("3-Panel 레이아웃이 렌더링된다", async ({ page }) => {
    await expect(page.locator('[data-testid="file-list-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="result-empty"]')).toBeVisible();
  });

  test("파일 목록 패널에 빈 상태 메시지가 표시된다", async ({ page }) => {
    const emptyState = page.locator('[data-testid="empty-state"]');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("파일을 여기에 드래그");
    await expect(emptyState).toContainText(".hwpx, .docx, .pdf");
  });

  test("미리보기 패널에 빈 상태 메시지가 표시된다", async ({ page }) => {
    const preview = page.locator('[data-testid="preview-empty"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("파일을 선택하세요");
  });

  test("결과 패널에 빈 상태 메시지가 표시된다", async ({ page }) => {
    const result = page.locator('[data-testid="result-empty"]');
    await expect(result).toBeVisible();
    await expect(result).toContainText("변환 결과가 여기에 표시됩니다");
  });

  test("패널 리사이즈 핸들이 존재한다", async ({ page }) => {
    const handles = page.locator("[data-panel-resize-handle-id]");
    await expect(handles).toHaveCount(2);
  });
});
