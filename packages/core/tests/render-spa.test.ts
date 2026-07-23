import { describe, expect, it, vi } from "vitest";
import type { PlaywrightModule } from "../src/html/render-spa.js";
import { renderSpa } from "../src/html/render-spa.js";

const RENDERED_HTML =
  '<html><body><div id="app">렌더링된 콘텐츠</div></body></html>';

type RouteHandler = (route: {
  request(): { url(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}) => Promise<void>;

function makeFakePlaywright(
  closeSpy = vi.fn(),
  onRoute?: (handler: RouteHandler) => void,
): PlaywrightModule {
  return {
    chromium: {
      launch: async () => ({
        newPage: async () => ({
          route: async (_pattern: string, handler: RouteHandler) => {
            onRoute?.(handler);
          },
          goto: async () => undefined,
          waitForSelector: async () => undefined,
          content: async () => RENDERED_HTML,
        }),
        close: closeSpy,
      }),
    },
  };
}

describe("renderSpa", () => {
  it("렌더링 완료 후 DOM HTML을 반환한다", async () => {
    // Arrange
    const closeSpy = vi.fn();

    // Act
    const html = await renderSpa("https://example.com/app", {
      loadPlaywright: async () => makeFakePlaywright(closeSpy),
      dnsLookup: (async () => [
        { address: "93.184.216.34", family: 4 },
      ]) as never,
    });

    // Assert
    expect(html).toContain("렌더링된 콘텐츠");
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it("playwright-core 미설치 시 한국어 안내 에러를 던진다", async () => {
    await expect(
      renderSpa("https://example.com/app", {
        loadPlaywright: async () => {
          throw new Error("Cannot find module 'playwright-core'");
        },
        dnsLookup: (async () => [
          { address: "93.184.216.34", family: 4 },
        ]) as never,
      }),
    ).rejects.toThrow("SPA 렌더링에는 playwright-core 패키지가 필요합니다");
  });

  it("사설 IP URL 렌더링을 차단한다 (SSRF)", async () => {
    await expect(
      renderSpa("http://127.0.0.1:8080/", {
        loadPlaywright: async () => makeFakePlaywright(),
      }),
    ).rejects.toThrow("SPA 렌더링이 차단되었습니다");
  });

  it("http(s) 외 스킴을 차단한다", async () => {
    await expect(
      renderSpa("file:///etc/passwd", {
        loadPlaywright: async () => makeFakePlaywright(),
      }),
    ).rejects.toThrow("SPA 렌더링이 차단되었습니다");
  });

  it("sub-resource 요청도 SSRF 가드로 필터링한다", async () => {
    // Arrange: route 핸들러를 캡처
    let handler: RouteHandler | undefined;
    await renderSpa("https://example.com/app", {
      loadPlaywright: async () =>
        makeFakePlaywright(vi.fn(), (h) => {
          handler = h;
        }),
      dnsLookup: (async () => [
        { address: "93.184.216.34", family: 4 },
      ]) as never,
    });
    expect(handler).toBeDefined();
    if (!handler) return;

    // Act & Assert: 사설 IP sub-request는 abort
    const abortSpy = vi.fn();
    const continueSpy = vi.fn();
    await handler({
      request: () => ({ url: () => "http://169.254.169.254/latest/meta-data" }),
      abort: async () => abortSpy(),
      continue: async () => continueSpy(),
    });
    expect(abortSpy).toHaveBeenCalledOnce();
    expect(continueSpy).not.toHaveBeenCalled();

    // 공개 IP sub-request는 continue (renderSpa 옵션의 dnsLookup은
    // 핸들러 생성 시점에 캡처되어 공개 IP를 반환한다)
    await handler({
      request: () => ({ url: () => "https://cdn.example.com/app.js" }),
      abort: async () => abortSpy(),
      continue: async () => continueSpy(),
    });
    expect(continueSpy).toHaveBeenCalledOnce();
  });
});
