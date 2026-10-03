// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mainThreadRender = vi.fn((markdown: string) => `<p>main:${markdown}</p>`);
vi.mock("../../src/lib/markdown-html", () => ({
  renderMarkdownToHtml: (markdown: string) => mainThreadRender(markdown),
}));

import { useMarkdownHtml } from "../../src/hooks/use-markdown-html";

interface Posted {
  readonly id: number;
  readonly markdown: string;
}

/** 응답 시점을 테스트가 정하는 가짜 Worker */
class FakeWorker {
  static instances: Array<FakeWorker> = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror:
    | ((event: { message: string; preventDefault: () => void }) => void)
    | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: Array<Posted> = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: Posted): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(html: string): void {
    const last = this.posted.at(-1);
    if (!last) throw new Error("보낸 요청이 없다");
    this.onmessage?.({ data: { id: last.id, html } });
  }

  crash(message: string): void {
    this.onerror?.({ message, preventDefault: () => undefined });
  }
}

function latestWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (!worker) throw new Error("Worker 가 없다");
  return worker;
}

beforeEach(() => {
  FakeWorker.instances = [];
  mainThreadRender.mockClear();
  vi.stubGlobal("Worker", FakeWorker);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 디바운스를 넘기고 promise 후속 처리까지 흘려보낸다 */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
}

describe("useMarkdownHtml", () => {
  it("첫 요청은 바로 보내고, 응답이 오면 HTML 을 돌려준다", async () => {
    const { result } = renderHook(({ md }) => useMarkdownHtml(md), {
      initialProps: { md: "# 하나" },
    });
    expect(result.current.html).toBeNull();
    expect(latestWorker().posted.map((p) => p.markdown)).toEqual(["# 하나"]);

    await act(async () => latestWorker().reply("<h1>하나</h1>"));

    expect(result.current.html).toBe("<h1>하나</h1>");
    expect(result.current.isPending).toBe(false);
  });

  it("처리 중에 들어온 변경은 가장 새 것 하나만 기다렸다가 보낸다 — 처리 중인 일은 버리지 않는다", async () => {
    const { result, rerender } = renderHook(({ md }) => useMarkdownHtml(md), {
      initialProps: { md: "v1" },
    });
    await act(async () => latestWorker().reply("<p>v1</p>"));

    rerender({ md: "v2" });
    await flush();
    rerender({ md: "v3" });
    await flush();
    rerender({ md: "v4" });
    await flush();

    const worker = latestWorker();
    // v2 는 처리 중이라 끝까지 두고, v3 은 v4 에 밀려 보내지지 않는다
    expect(worker.terminated).toBe(false);
    expect(worker.posted.map((p) => p.markdown)).toEqual(["v1", "v2"]);
    expect(result.current.isPending).toBe(true);

    await act(async () => worker.reply("<p>v2</p>"));
    expect(worker.posted.map((p) => p.markdown)).toEqual(["v1", "v2", "v4"]);

    await act(async () => worker.reply("<p>v4</p>"));
    expect(result.current.html).toBe("<p>v4</p>");
    expect(result.current.isPending).toBe(false);
  });

  it("Worker 가 로드조차 안 되면 메인 스레드에서 대신 만든다", async () => {
    const { result } = renderHook(({ md }) => useMarkdownHtml(md), {
      initialProps: { md: "# 대체" },
    });

    await act(async () => latestWorker().crash("document is not defined"));

    expect(mainThreadRender).toHaveBeenCalledWith("# 대체");
    expect(result.current.html).toBe("<p>main:# 대체</p>");
  });

  it("응답한 적 있는 Worker 가 죽으면 메인 스레드로 넘기지 않고, 직전 결과를 둔 채 오류를 알린다", async () => {
    const { result, rerender } = renderHook(({ md }) => useMarkdownHtml(md), {
      initialProps: { md: "작은 문서" },
    });
    await act(async () => latestWorker().reply("<p>작은 문서</p>"));

    rerender({ md: "거대 문서" });
    await flush();
    await act(async () => latestWorker().crash("out of memory"));

    // 같은 거대 문서를 메인 스레드에서 다시 돌리면 앱이 멈춘다
    expect(mainThreadRender).not.toHaveBeenCalled();
    expect(result.current.error).toBe("out of memory");
    expect(result.current.html).toBe("<p>작은 문서</p>");

    // 다음 변경은 새 Worker 로 처리한다
    rerender({ md: "고친 문서" });
    await flush();
    expect(FakeWorker.instances.length).toBe(2);
    await act(async () => latestWorker().reply("<p>고친 문서</p>"));
    expect(result.current.html).toBe("<p>고친 문서</p>");
    expect(result.current.error).toBeNull();
  });
});
