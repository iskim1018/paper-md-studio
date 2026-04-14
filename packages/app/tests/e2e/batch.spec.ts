import { expect, type Page, test } from "@playwright/test";

/**
 * Phase 6 배치 처리 E2E.
 *
 * 실제 변환은 Tauri sidecar에 의존하므로 브라우저 dev 모드에서 호출
 * 불가. 대신 window에 노출된 __FILE_STORE__ / __QUEUE_STORE__ /
 * __SETTINGS_STORE__를 직접 조작하여 UI 반응만 검증한다.
 */

async function addPendingFiles(page: Page, paths: ReadonlyArray<string>) {
  await page.evaluate((p) => {
    const store = (window as Record<string, unknown>).__FILE_STORE__ as {
      getState: () => { addFiles: (paths: ReadonlyArray<string>) => void };
    };
    store.getState().addFiles(p);
  }, paths);
}

async function setFileStatus(
  page: Page,
  index: number,
  status: "pending" | "converting" | "done" | "error",
  extra: Record<string, unknown> = {},
) {
  await page.evaluate(
    ({ i, s, ex }) => {
      const store = (window as Record<string, unknown>).__FILE_STORE__ as {
        getState: () => {
          files: ReadonlyArray<{ id: string }>;
          updateFile: (id: string, update: Record<string, unknown>) => void;
        };
      };
      const id = store.getState().files[i]?.id;
      if (!id) throw new Error(`no file at index ${i}`);
      store.getState().updateFile(id, { status: s, ...ex });
    },
    { i: index, s: status, ex: extra },
  );
}

async function setQueueState(
  page: Page,
  state: {
    running: number;
    pending: number;
    completed: number;
    failed: number;
    active: boolean;
  },
) {
  await page.evaluate((s) => {
    const store = (window as Record<string, unknown>).__QUEUE_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState(s);
  }, state);
}

test.describe("출력 폴더 선택 (Phase 6-3)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("docs-to-md:settings");
    });
    await page.goto("/");
  });

  test("기본 출력은 '원본 폴더'로 표시된다", async ({ page }) => {
    const selector = page.locator('[data-testid="output-dir-selector"]');
    await expect(selector).toBeVisible();
    await expect(selector).toContainText("출력");
    await expect(selector).toContainText("원본 폴더");
  });

  test("리셋 버튼은 outputDir이 null이면 표시되지 않는다", async ({ page }) => {
    await expect(
      page.locator('[data-testid="output-dir-reset-btn"]'),
    ).toHaveCount(0);
  });

  test("settings store에 outputDir을 설정하면 selector에 반영되고 리셋 버튼이 나타난다", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__SETTINGS_STORE__ as {
        getState: () => { setOutputDir: (dir: string | null) => void };
      };
      store.getState().setOutputDir("/Users/test/output");
    });

    const selector = page.locator('[data-testid="output-dir-selector"]');
    await expect(selector).toContainText("/Users/test/output");
    await expect(
      page.locator('[data-testid="output-dir-reset-btn"]'),
    ).toBeVisible();
  });

  test("리셋 버튼 클릭 시 원본 폴더로 되돌아간다", async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__SETTINGS_STORE__ as {
        getState: () => { setOutputDir: (dir: string | null) => void };
      };
      store.getState().setOutputDir("/tmp/foo");
    });
    await page.locator('[data-testid="output-dir-reset-btn"]').click();

    await expect(
      page.locator('[data-testid="output-dir-selector"]'),
    ).toContainText("원본 폴더");
    await expect(
      page.locator('[data-testid="output-dir-reset-btn"]'),
    ).toHaveCount(0);
  });
});

test.describe("배치 진행률 (Phase 6-2)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("배치 비활성 상태에서는 진행 바가 숨겨진다", async ({ page }) => {
    await expect(page.locator('[data-testid="batch-progress"]')).toHaveCount(0);
  });

  test("queue active 상태에서 진행 바와 통계가 표시된다", async ({ page }) => {
    await setQueueState(page, {
      running: 2,
      pending: 3,
      completed: 5,
      failed: 0,
      active: true,
    });

    const bar = page.locator('[data-testid="batch-progress"]');
    await expect(bar).toBeVisible();
    // total = 10, done = 5 → 50%
    await expect(bar).toContainText("5/10");
    await expect(bar).toContainText("50%");
    await expect(
      page.locator('[data-testid="batch-cancel-btn"]'),
    ).toBeVisible();
  });

  test("실패가 있으면 실패 배지가 표시된다", async ({ page }) => {
    await setQueueState(page, {
      running: 0,
      pending: 0,
      completed: 8,
      failed: 2,
      active: false,
    });

    const badge = page.locator('[data-testid="batch-failed-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("실패 2");
  });

  test("취소 버튼은 클릭 가능하며 store 액션과 연결되어 있다", async ({
    page,
  }) => {
    await setQueueState(page, {
      running: 1,
      pending: 4,
      completed: 0,
      failed: 0,
      active: true,
    });

    // store action을 spy로 감싸서 호출 여부 확인
    await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__QUEUE_STORE__ as {
        getState: () => { cancelAll: () => void };
        setState: (s: Record<string, unknown>) => void;
      };
      let called = false;
      const original = store.getState().cancelAll;
      store.setState({
        cancelAll: () => {
          called = true;
          original();
        },
      });
      (window as Record<string, unknown>).__cancelCalled = () => called;
    });

    await page.locator('[data-testid="batch-cancel-btn"]').click();

    const called = await page.evaluate(() => {
      const fn = (window as Record<string, unknown>).__cancelCalled as
        | (() => boolean)
        | undefined;
      return fn?.() ?? false;
    });
    expect(called).toBe(true);
  });
});

test.describe("재시도 버튼 (Phase 6-4)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await addPendingFiles(page, ["/tmp/a.docx", "/tmp/b.pdf", "/tmp/c.hwpx"]);
  });

  test("error 상태 파일에는 행 단위 재시도 버튼이 노출된다", async ({
    page,
  }) => {
    await setFileStatus(page, 1, "error", { error: "boom" });

    const fileId = await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FILE_STORE__ as {
        getState: () => { files: ReadonlyArray<{ id: string }> };
      };
      return store.getState().files[1]?.id;
    });

    await expect(
      page.locator(`[data-testid="retry-btn-${fileId}"]`),
    ).toBeVisible();
  });

  test("실패한 파일이 있으면 '실패 N개 재시도' 일괄 버튼이 표시된다", async ({
    page,
  }) => {
    await setFileStatus(page, 0, "error", { error: "x" });
    await setFileStatus(page, 2, "error", { error: "y" });

    const btn = page.locator('[data-testid="retry-failed-btn"]');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText("실패 2개 재시도");
  });

  test("실패 0건이면 일괄 재시도 버튼은 숨겨진다", async ({ page }) => {
    await expect(page.locator('[data-testid="retry-failed-btn"]')).toHaveCount(
      0,
    );
  });
});
