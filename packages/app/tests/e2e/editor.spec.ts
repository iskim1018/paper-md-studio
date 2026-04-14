import { expect, type Page, test } from "@playwright/test";

/**
 * Phase 5 MD 에디터 E2E.
 *
 * Tauri sidecar/fs는 Playwright(브라우저 dev 모드)에서 호출 불가하므로
 * window에 노출된 __FILE_STORE__를 직접 조작하여 "변환 완료" 상태를
 * 시뮬레이션한다. 파일 저장(saveMarkdownTo)은 Tauri 플러그인 호출이
 * 실패하므로 UI 상태(mode 토글, dirty 인디케이터, 저장 버튼 활성화)만
 * 검증한다.
 */

async function seedDoneFile(
  page: Page,
  options: {
    readonly path?: string;
    readonly markdown?: string;
  } = {},
) {
  const path = options.path ?? "/tmp/test/문서.docx";
  const markdown = options.markdown ?? "# 테스트 문서\n\n본문 내용입니다.";

  await page.evaluate(
    ({ p, md }) => {
      const store = (window as Record<string, unknown>).__FILE_STORE__ as {
        getState: () => {
          addFiles: (paths: Array<string>) => void;
          files: ReadonlyArray<{ id: string; path: string }>;
          updateFile: (id: string, update: Record<string, unknown>) => void;
        };
      };
      store.getState().addFiles([p]);
      const file = store
        .getState()
        .files.find((f: { path: string }) => f.path === p);
      if (!file) throw new Error("seed failed");
      store.getState().updateFile(file.id, {
        status: "done",
        result: {
          markdown: md,
          format: "docx",
          elapsed: 123,
          imageCount: 0,
          outputPath: p.replace(/\.[^.]+$/, ".md"),
        },
      });
    },
    { p: path, md: markdown },
  );
}

test.describe("ResultPanel 에디터 모드", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await seedDoneFile(page);
  });

  test("변환 완료 후 4-모드 토글이 표시된다", async ({ page }) => {
    const toggle = page.locator('[data-testid="mode-toggle"]');
    await expect(toggle).toBeVisible();
    await expect(page.locator('[data-testid="mode-preview"]')).toBeVisible();
    await expect(page.locator('[data-testid="mode-edit"]')).toBeVisible();
    await expect(page.locator('[data-testid="mode-source"]')).toBeVisible();
    await expect(page.locator('[data-testid="mode-split"]')).toBeVisible();
  });

  test("기본 모드는 보기이며 렌더링된 Markdown 프리뷰가 표시된다", async ({
    page,
  }) => {
    const preview = page.locator('[data-testid="markdown-preview"]').first();
    await expect(preview).toBeVisible();
    // react-markdown으로 h1이 렌더링되어야 함
    await expect(preview.locator("h1")).toContainText("테스트 문서");
  });

  test("편집 모드로 전환하면 Milkdown 에디터가 노출된다", async ({ page }) => {
    await page.locator('[data-testid="mode-edit"]').click();
    await expect(page.locator('[data-testid="milkdown-editor"]')).toBeVisible();
  });

  test("소스 모드로 전환하면 CodeMirror 에디터가 노출된다", async ({
    page,
  }) => {
    await page.locator('[data-testid="mode-source"]').click();
    await expect(page.locator('[data-testid="source-editor"]')).toBeVisible();
  });

  test("분할 모드로 전환하면 소스 에디터+프리뷰가 동시에 표시된다", async ({
    page,
  }) => {
    await page.locator('[data-testid="mode-split"]').click();
    await expect(page.locator('[data-testid="split-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="source-editor"]')).toBeVisible();
    await expect(page.locator('[data-testid="split-preview"]')).toBeVisible();
    // 렌더링된 markdown-preview 안의 h1에 제목이 있어야 함
    await expect(
      page.locator(
        '[data-testid="split-preview"] [data-testid="markdown-preview"] h1',
      ),
    ).toContainText("테스트 문서");
  });
});

test.describe("저장 버튼 dirty 연동", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await seedDoneFile(page);
  });

  test("초기에는 저장 버튼이 비활성 (dirty 아님)", async ({ page }) => {
    await expect(page.locator('[data-testid="save-btn"]')).toBeDisabled();
    await expect(page.locator('[data-testid="dirty-indicator"]')).toHaveCount(
      0,
    );
  });

  test("편집 내용이 원본과 다르면 dirty 인디케이터와 저장 버튼이 활성화된다", async ({
    page,
  }) => {
    // 스토어에서 직접 setEditedMarkdown 호출 (실제 Milkdown 편집 이벤트 시뮬)
    await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FILE_STORE__ as {
        getState: () => {
          files: ReadonlyArray<{ id: string }>;
          setEditedMarkdown: (id: string, md: string) => void;
        };
      };
      const id = store.getState().files[0]?.id;
      if (id) store.getState().setEditedMarkdown(id, "# 수정된 내용");
    });

    await expect(page.locator('[data-testid="dirty-indicator"]')).toBeVisible();
    await expect(page.locator('[data-testid="save-btn"]')).toBeEnabled();
  });

  test("다른 이름 저장 버튼은 항상 활성화되어 있다", async ({ page }) => {
    await expect(page.locator('[data-testid="save-as-btn"]')).toBeEnabled();
  });
});

test.describe("테마 토글", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
    });
    await page.goto("/");
  });

  test("헤더에 테마 토글 버튼이 노출된다", async ({ page }) => {
    const toggle = page.locator('[data-testid="theme-toggle"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText("시스템");
  });

  test("클릭 시 system → light → dark → system 순으로 순환한다", async ({
    page,
  }) => {
    const toggle = page.locator('[data-testid="theme-toggle"]');

    await toggle.click();
    await expect(toggle).toContainText("라이트");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await toggle.click();
    await expect(toggle).toContainText("다크");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await toggle.click();
    await expect(toggle).toContainText("시스템");
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-theme",
      "dark",
    );
  });

  test("선택한 테마는 localStorage에 영속화된다", async ({ page }) => {
    await page.locator('[data-testid="theme-toggle"]').click();

    const stored = await page.evaluate(() =>
      window.localStorage.getItem("docs-to-md:theme"),
    );
    expect(stored).toBe("light");
  });
});

test.describe("결과 패널 전체화면 토글 (Phase 5.5-2)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await seedDoneFile(page);
  });

  test("기본 상태에서는 3-패널 레이아웃, 전체화면 버튼이 표시된다", async ({
    page,
  }) => {
    await expect(page.locator('[data-testid="file-list-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="result-panel"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="fullscreen-toggle"]'),
    ).toBeVisible();
  });

  test("토글 클릭 시 결과 패널만 남고 다시 클릭하면 복원된다", async ({
    page,
  }) => {
    await page.locator('[data-testid="fullscreen-toggle"]').click();

    await expect(
      page.locator('[data-testid="fullscreen-result"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="result-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-list-panel"]')).toHaveCount(
      0,
    );
    await expect(page.locator('[data-testid="preview-panel"]')).toHaveCount(0);

    await page.locator('[data-testid="fullscreen-toggle"]').click();

    await expect(page.locator('[data-testid="fullscreen-result"]')).toHaveCount(
      0,
    );
    await expect(page.locator('[data-testid="file-list-panel"]')).toBeVisible();
  });

  test("Cmd/Ctrl+Shift+F 단축키로 전체화면을 토글한다", async ({ page }) => {
    await page.keyboard.press("Control+Shift+F");
    await expect(
      page.locator('[data-testid="fullscreen-result"]'),
    ).toBeVisible();

    await page.keyboard.press("Control+Shift+F");
    await expect(page.locator('[data-testid="fullscreen-result"]')).toHaveCount(
      0,
    );
  });
});

test.describe("빈 행 정리 (Phase 5.5-5)", () => {
  // 헤더(빈) + 구분선 + 내용 + 빈 body row가 섞인 GFM 테이블
  const tableWithEmpty = `|  |
| --- |
| **샘플 문서 제목** |
|  |

본문 내용`;

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await seedDoneFile(page, { markdown: tableWithEmpty });
  });

  test("빈 행 정리 버튼이 표시되고 클릭 시 정리 취소 배너가 나타난다", async ({
    page,
  }) => {
    const btn = page.locator('[data-testid="remove-empty-rows-btn"]');
    await expect(btn).toBeVisible();
    await expect(page.locator('[data-testid="cleanup-banner"]')).toHaveCount(0);

    await btn.click();

    await expect(page.locator('[data-testid="cleanup-banner"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="undo-cleanup-btn"]'),
    ).toBeVisible();
    // 편집 발생 → dirty 인디케이터 + 저장 버튼 활성
    await expect(page.locator('[data-testid="dirty-indicator"]')).toBeVisible();
    await expect(page.locator('[data-testid="save-btn"]')).toBeEnabled();
  });

  test("정리 후 헤더 row(구분선 앞 빈 row)는 보존된다", async ({ page }) => {
    await page.locator('[data-testid="remove-empty-rows-btn"]').click();

    const edited = await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FILE_STORE__ as {
        getState: () => {
          files: ReadonlyArray<{ editedMarkdown: string | null }>;
        };
      };
      return store.getState().files[0]?.editedMarkdown ?? "";
    });

    // 헤더 빈 row + 구분선은 유지, 본문 빈 row는 제거
    expect(edited).toContain("|  |\n| --- |");
    expect(edited).toContain("| **샘플 문서 제목** |");
    // 구분선 뒤 빈 body row 제거 확인
    const lines = edited.split("\n");
    const sepIdx = lines.findIndex((l) => l.trim() === "| --- |");
    const after = lines.slice(sepIdx + 1).filter((l) => l.startsWith("|"));
    // body에 남는 row는 "| **샘플 문서 제목** |" 1개뿐
    expect(after).toHaveLength(1);
  });

  test("정리 취소 버튼으로 원본 복구 + 배너 사라짐", async ({ page }) => {
    await page.locator('[data-testid="remove-empty-rows-btn"]').click();
    await page.locator('[data-testid="undo-cleanup-btn"]').click();

    await expect(page.locator('[data-testid="cleanup-banner"]')).toHaveCount(0);

    const edited = await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__FILE_STORE__ as {
        getState: () => {
          files: ReadonlyArray<{ editedMarkdown: string | null }>;
        };
      };
      return store.getState().files[0]?.editedMarkdown ?? "";
    });
    // 원본의 빈 body row가 다시 살아남
    expect(edited).toBe(tableWithEmpty);
  });
});
