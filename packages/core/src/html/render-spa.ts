import type { lookup } from "node:dns/promises";
import { validateFetchUrl } from "../net/safe-fetch.js";

/**
 * playwright-core는 optionalDependency라서 타입을 직접 참조하지 않고
 * 필요한 표면만 구조적 타입으로 좁힌다.
 */
interface SpaRoute {
  request(): { url(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}

interface SpaPage {
  route(
    pattern: string,
    handler: (route: SpaRoute) => Promise<void>,
  ): Promise<unknown>;
  goto(
    url: string,
    options?: { waitUntil?: "networkidle"; timeout?: number },
  ): Promise<unknown>;
  waitForSelector(
    selector: string,
    options?: { timeout?: number },
  ): Promise<unknown>;
  content(): Promise<string>;
}

interface SpaBrowser {
  newPage(): Promise<SpaPage>;
  close(): Promise<void>;
}

interface SpaBrowserType {
  launch(options?: {
    channel?: string;
    headless?: boolean;
  }): Promise<SpaBrowser>;
}

export interface PlaywrightModule {
  readonly chromium: SpaBrowserType;
}

export interface RenderSpaOptions {
  /** 렌더링·네비게이션 시간 제한 (ms) */
  readonly timeoutMs?: number;
  /** 렌더 완료 판정을 위해 추가로 대기할 CSS 셀렉터 */
  readonly waitSelector?: string;
  /** 테스트 주입용 — 기본값은 dns.lookup */
  readonly dnsLookup?: typeof lookup;
  /** 테스트 주입용 — 기본값은 playwright-core 동적 import */
  readonly loadPlaywright?: () => Promise<PlaywrightModule>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * headless 브라우저로 URL을 렌더링한 뒤 최종 DOM HTML을 반환한다.
 *
 * 네비게이션 URL을 사전 검증하고, 페이지가 발생시키는 모든 sub-resource
 * 요청도 route 인터셉션으로 동일하게 검증해 사설 대역 접근을 차단한다.
 * 단 DNS rebinding 등 완전한 방어는 아니므로 opt-in 기능으로 유지한다.
 */
export async function renderSpa(
  url: string,
  options: RenderSpaOptions = {},
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`URL 형식이 올바르지 않습니다: ${url}`);
  }

  const guard = await validateFetchUrl(
    parsed,
    options.dnsLookup ? { dnsLookup: options.dnsLookup } : {},
  );
  if (!guard.ok) {
    throw new Error(`SPA 렌더링이 차단되었습니다: ${guard.message}`);
  }

  const load = options.loadPlaywright ?? loadPlaywrightCore;
  let playwright: PlaywrightModule;
  try {
    playwright = await load();
  } catch {
    throw new Error(
      "SPA 렌더링에는 playwright-core 패키지가 필요합니다. " +
        "'pnpm add playwright-core' 설치 후 다시 시도해주세요.",
    );
  }

  const browser = await launchBrowser(playwright);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      guardSubRequest(route, options.dnsLookup),
    );
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    if (options.waitSelector) {
      await page.waitForSelector(options.waitSelector, { timeout: timeoutMs });
    }
    return await page.content();
  } finally {
    await browser.close();
  }
}

/** 페이지가 발생시키는 sub-resource 요청도 SSRF 가드를 통과해야 허용 */
async function guardSubRequest(
  route: SpaRoute,
  dnsLookup: RenderSpaOptions["dnsLookup"],
): Promise<void> {
  try {
    const requestUrl = new URL(route.request().url());
    const guard = await validateFetchUrl(
      requestUrl,
      dnsLookup ? { dnsLookup } : {},
    );
    if (guard.ok) {
      await route.continue();
      return;
    }
  } catch {
    // URL 파싱·검증 실패 시 차단으로 폴백
  }
  await route.abort();
}

async function loadPlaywrightCore(): Promise<PlaywrightModule> {
  const mod = await import("playwright-core");
  return mod as unknown as PlaywrightModule;
}

async function launchBrowser(
  playwright: PlaywrightModule,
): Promise<SpaBrowser> {
  // 시스템 Chrome 우선, 실패 시 playwright가 관리하는 브라우저 시도
  try {
    return await playwright.chromium.launch({
      channel: "chrome",
      headless: true,
    });
  } catch {
    try {
      return await playwright.chromium.launch({ headless: true });
    } catch {
      throw new Error(
        "헤드리스 브라우저를 시작하지 못했습니다. " +
          "Chrome 브라우저가 설치되어 있는지 확인해주세요.",
      );
    }
  }
}
