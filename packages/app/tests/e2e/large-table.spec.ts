import { expect, type Page, test } from "@playwright/test";

/**
 * 큰 표 미리보기 E2E.
 *
 * 실물 엑셀 결과(표 5,900행)를 고르면 미리보기가 3.6초 멈추던 문제의 회귀를
 * 막는다. 진짜 브라우저에서만 확인되는 것들을 본다: Worker 가 HTML 을 만들어
 * 오는지, 큰 표가 행 묶음으로 나뉘는지, 화면 밖 묶음의 셀도 검색되는지.
 *
 * Worker 가 죽어도 미리보기는 메인 스레드 대체 경로로 **똑같이** 그려진다. 그래서
 * 화면만 보면 Worker 가 로드 즉시 죽던 결함(의존성의 `browser` 빌드가 document 를
 * 씀)을 못 잡았다 — Worker 의 응답·오류를 직접 센다.
 */

/** 페이지의 Worker 응답·오류를 센다 (앱 코드에 시험용 출입구를 두지 않으려고) */
async function watchWorkers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stats = { replies: 0, errors: [] as Array<string> };
    (window as unknown as { __workerStats: typeof stats }).__workerStats =
      stats;
    const Base = window.Worker;
    window.Worker = class extends Base {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", () => {
          stats.replies += 1;
        });
        this.addEventListener("error", (event) => {
          stats.errors.push(event.message);
        });
      }
    };
  });
}

async function workerStats(
  page: Page,
): Promise<{ replies: number; errors: Array<string> }> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __workerStats: { replies: number; errors: Array<string> };
        }
      ).__workerStats,
  );
}

const ROWS = 3000;
const LAST_ROW_MARKER = "마지막행표식";

function bigTableMarkdown(rows: number): string {
  const lines = [
    "# 큰 표",
    "",
    "| 번호 | 항목 | 설명 |",
    "| --- | --- | --- |",
  ];
  for (let r = 0; r < rows; r += 1) {
    const note = r === rows - 1 ? LAST_ROW_MARKER : `설명 ${r}`;
    lines.push(`| ${r} | 항목 ${r} | ${note} |`);
  }
  return lines.join("\n");
}

async function seedDoneFile(page: Page, markdown: string): Promise<void> {
  await page.evaluate((md) => {
    const store = (window as Record<string, unknown>).__FILE_STORE__ as {
      getState: () => {
        addFiles: (paths: Array<string>) => void;
        files: ReadonlyArray<{ id: string; path: string }>;
        updateFile: (id: string, update: Record<string, unknown>) => void;
      };
    };
    const path = "/tmp/test/큰표.xlsx";
    store.getState().addFiles([path]);
    const file = store.getState().files.find((f) => f.path === path);
    if (!file) throw new Error("seed failed");
    store.getState().updateFile(file.id, {
      status: "done",
      result: {
        markdown: md,
        format: "xlsx",
        elapsed: 1,
        imageCount: 0,
        outputPath: "/tmp/test/큰표.md",
      },
    });
  }, markdown);
}

test.describe("큰 표 미리보기", () => {
  test.beforeEach(async ({ page }) => {
    await watchWorkers(page);
    await page.goto("/");
    await seedDoneFile(page, bigTableMarkdown(ROWS));
  });

  test("큰 표는 행 묶음으로 나뉘고 모든 행이 들어 있다", async ({ page }) => {
    const content = page.locator('[data-testid="markdown-preview-content"]');
    await expect(content.locator("h1")).toContainText("큰 표");
    await expect(content.locator(".table-chunk")).toHaveCount(ROWS / 100);
    await expect(content.locator("tbody tr")).toHaveCount(ROWS);
    // 머리 행은 첫 묶음에만 있다
    await expect(content.locator("thead")).toHaveCount(1);
    // 메인 스레드 대체 경로가 아니라 Worker 가 만들었어야 한다
    const stats = await workerStats(page);
    expect(stats.errors).toEqual([]);
    expect(stats.replies).toBeGreaterThan(0);
  });

  test("화면 밖 묶음에 있는 셀도 검색해서 그 자리로 스크롤한다", async ({
    page,
  }) => {
    const content = page.locator('[data-testid="markdown-preview-content"]');
    await expect(content.locator("tbody tr")).toHaveCount(ROWS);

    await page.locator('[data-testid="markdown-preview"]').click();
    await page.keyboard.press("ControlOrMeta+f");
    await page
      .locator('[data-testid="text-search-bar"] input')
      .fill(LAST_ROW_MARKER);

    await expect(
      page.locator('[data-testid="text-search-counter"]'),
    ).toHaveText("1/1");
    // 하이라이트는 DOM 을 감싸지 않는 CSS Highlight API 라 요소가 없다 — 활성
    // 매치의 Range 가 보이는 자리에 왔는지 본다 (부드러운 스크롤을 기다린다)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const registry = (
            CSS as unknown as {
              highlights: Map<string, Set<Range>>;
            }
          ).highlights;
          const [range] = [...(registry.get("text-search-match-active") ?? [])];
          if (!range) return false;
          const rect = range.getBoundingClientRect();
          return rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
        }),
      )
      .toBe(true);
  });
});

test.describe("기본 패널 비율", () => {
  test("탐색 트리는 좁고 두 뷰어가 같은 폭을 나눠 갖는다", async ({ page }) => {
    await page.goto("/");
    const width = async (id: string) =>
      (await page.locator(`[data-panel-id="${id}"]`).boundingBox())?.width ?? 0;

    const fileList = await width("filelist");
    const preview = await width("preview");
    const result = await width("result");
    const total = fileList + preview + result;

    expect(fileList / total).toBeGreaterThan(0.15);
    expect(fileList / total).toBeLessThan(0.21);
    expect(Math.abs(preview - result)).toBeLessThan(2);
  });
});
