import { expect, test } from "@playwright/test";

/**
 * 엑셀 숨김 항목 배너의 종단 동작.
 *
 * 숨긴 게 있는 파일에서만 배너가 뜨고, 버튼 한 번으로 포함/제외를 오갈 수
 * 있어야 한다. 실제 변환은 Tauri sidecar가 필요하므로 여기서는 스토어에
 * 변환 결과를 주입해 UI 계약만 확인한다.
 */

interface SeedResult {
  readonly hiddenExcluded?: { sheets: number; rows: number; cols: number };
  readonly warnings?: Array<string>;
}

async function seedConvertedXlsx(
  page: import("@playwright/test").Page,
  result: SeedResult,
): Promise<void> {
  await page.evaluate((seed) => {
    const store = (window as Record<string, unknown>).__FILE_STORE__ as {
      getState: () => {
        addFiles: (paths: Array<string>) => void;
        updateFile: (id: string, update: unknown) => void;
        files: Array<{ id: string }>;
      };
    };
    store.getState().addFiles(["/docs/재고관리.xlsx"]);
    const id = store.getState().files[0]?.id;
    if (!id) throw new Error("파일 추가 실패");
    store.getState().updateFile(id, {
      status: "done",
      result: {
        markdown:
          "## 재고\n\n| 품목 | 판매가 | 비고 |\n| --- | --- | --- |\n| 연필 | 500 | 재고 많음 |\n",
        format: "xlsx",
        elapsed: 42,
        imageCount: 0,
        outputPath: "/docs/재고관리.md",
        ...seed,
      },
    });
  }, result);
}

test.describe("엑셀 숨김 항목 배너", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("숨긴 항목이 제외되면 배너와 포함 버튼이 뜬다", async ({ page }) => {
    await seedConvertedXlsx(page, {
      hiddenExcluded: { sheets: 0, rows: 0, cols: 1 },
      warnings: ['시트 "재고"의 숨겨진 열 1개를 제외했습니다.'],
    });

    const banner = page.locator('[data-testid="conversion-warnings"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("숨겨진 열 1개를 제외했습니다");
    await expect(page.locator('[data-testid="toggle-hidden-btn"]')).toHaveText(
      "숨긴 항목 포함해 다시 변환",
    );
  });

  test("숨긴 항목이 없으면 배너가 아예 뜨지 않는다", async ({ page }) => {
    await seedConvertedXlsx(page, {});

    await expect(
      page.locator('[data-testid="conversion-warnings"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="toggle-hidden-btn"]')).toHaveCount(
      0,
    );
  });

  test("버튼을 누르면 직전 결과가 화면에 남아 있다", async ({ page }) => {
    await seedConvertedXlsx(page, {
      hiddenExcluded: { sheets: 0, rows: 0, cols: 1 },
      warnings: ['시트 "재고"의 숨겨진 열 1개를 제외했습니다.'],
    });

    await page.locator('[data-testid="toggle-hidden-btn"]').click();

    // 재변환은 sidecar가 없어 실패하지만, 그 전까지 직전 결과가 남아 있어야 한다
    // (버튼을 누른 순간 화면이 비면 깜빡임으로 보인다)
    await expect(page.locator('[data-testid="result-panel"]')).toBeVisible();
  });
});
