import { useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdownToHtml } from "../lib/markdown-html";
import type { MarkdownHtmlResponse } from "../lib/markdown-html.worker";

/**
 * 결과 미리보기의 Markdown → HTML 을 Web Worker 에서 만든다.
 *
 * 큰 문서(실물 엑셀 결과 2.7MB)는 파싱만 1.4초라 메인 스레드에서 돌리면
 * 그동안 앱이 멈춘다. Worker 가 정화된 HTML 문자열까지 만들어 넘기는 이유:
 * 트리(hast)를 넘기면 구조화 복제만 메인 스레드에서 0.4초가 걸린다.
 *
 * - 처리 중에 새 요청이 오면 기다리는 칸 하나에만 넣는다(더 새 요청이 오면
 *   덮어쓴다). 처리 중인 일을 버리고 새로 시작하면, 큰 문서를 분할 모드에서
 *   쉬엄쉬엄 편집할 때 처리가 끝나기 전에 계속 버려져 미리보기가 영영 갱신되지
 *   않는다.
 * - 처음 그린 뒤의 변경(편집·분할 모드 입력)은 잠깐 모아서 보낸다.
 * - Worker 를 쓸 수 없는 환경(jsdom 테스트, Worker 로드 실패)은 메인 스레드에서
 *   같은 함수를 부른다 — 느릴 뿐 결과는 같다. 한 번이라도 응답한 Worker 가 나중에
 *   죽는 것(거대 문서의 메모리 부족 등)은 로드 실패가 아니므로 메인 스레드로
 *   넘기지 않는다 — 같은 문서를 메인 스레드에서 다시 돌리면 앱이 멈춘다.
 */

/** 처음 그린 뒤의 변경은 이만큼 모아서 보낸다 */
const UPDATE_DEBOUNCE_MS = 150;

export interface MarkdownHtmlState {
  /** 정화된 HTML. 첫 결과가 오기 전에는 null */
  readonly html: string | null;
  readonly error: string | null;
  /** `html` 이 지금 `markdown` 보다 오래된 결과인가 (새 결과 대기 중) */
  readonly isPending: boolean;
}

interface RenderResult {
  readonly html: string | null;
  readonly error: string | null;
  /** 이 결과를 만든 Markdown */
  readonly source: string | null;
}

/** 더 새 요청에 밀려 버린 요청 — 사용자에게 알릴 일이 아니다 */
const SUPERSEDED = Symbol("superseded");

/** Worker 자체를 쓸 수 없음 (스크립트 로드 실패 등) → 메인 스레드로 대신한다 */
class WorkerUnavailableError extends Error {}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function renderOnMainThread(markdown: string): RenderResult {
  try {
    return {
      html: renderMarkdownToHtml(markdown),
      error: null,
      source: markdown,
    };
  } catch (err: unknown) {
    return { html: null, error: errorMessage(err), source: markdown };
  }
}

interface Job {
  readonly id: number;
  readonly markdown: string;
  readonly resolve: (html: string) => void;
  readonly reject: (reason: unknown) => void;
}

class WorkerRenderer {
  private worker: Worker | null = null;
  private running: Job | null = null;
  private queued: Job | null = null;
  private nextId = 1;
  private unavailable = false;
  private hasResponded = false;

  render(markdown: string): Promise<string> {
    if (this.unavailable) {
      return Promise.reject(new WorkerUnavailableError("Worker 사용 불가"));
    }
    return new Promise<string>((resolve, reject) => {
      const job: Job = { id: this.nextId, markdown, resolve, reject };
      this.nextId += 1;
      if (this.running) {
        // 처리 중인 일은 끝까지 두고, 기다리는 칸만 가장 새 요청으로 바꾼다
        this.queued?.reject(SUPERSEDED);
        this.queued = job;
        return;
      }
      this.start(job);
    });
  }

  dispose(): void {
    this.running?.reject(SUPERSEDED);
    this.queued?.reject(SUPERSEDED);
    this.running = null;
    this.queued = null;
    this.worker?.terminate();
    this.worker = null;
  }

  private start(job: Job): void {
    this.running = job;
    const worker = this.worker ?? this.spawn();
    worker.postMessage({ id: job.id, markdown: job.markdown });
  }

  private startQueued(): void {
    const next = this.queued;
    this.queued = null;
    if (next) this.start(next);
  }

  /** Worker 가 죽었다 — 로드 실패면 메인 스레드로, 실행 중 실패면 오류로 */
  private fail(worker: Worker, message: string): void {
    worker.terminate();
    if (this.worker === worker) this.worker = null;
    const failed = this.running;
    this.running = null;
    if (!this.hasResponded) {
      this.unavailable = true;
      failed?.reject(new WorkerUnavailableError(message));
      this.queued?.reject(new WorkerUnavailableError(message));
      this.queued = null;
      return;
    }
    failed?.reject(new Error(message));
    // 다음 요청은 새 Worker 로 처리한다
    this.startQueued();
  }

  private spawn(): Worker {
    const worker = new Worker(
      new URL("../lib/markdown-html.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<MarkdownHtmlResponse>) => {
      const job = this.running;
      if (!job || job.id !== event.data.id) return;
      this.hasResponded = true;
      this.running = null;
      if ("html" in event.data) job.resolve(event.data.html);
      else job.reject(new Error(event.data.error));
      this.startQueued();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.fail(worker, event.message || "미리보기 처리기가 중단되었습니다.");
    };
    worker.onmessageerror = () => {
      this.fail(worker, "미리보기 결과를 받지 못했습니다.");
    };
    this.worker = worker;
    return worker;
  }
}

export function useMarkdownHtml(markdown: string): MarkdownHtmlState {
  const canUseWorker = typeof Worker !== "undefined";
  const syncResult = useMemo(
    () => (canUseWorker ? null : renderOnMainThread(markdown)),
    [canUseWorker, markdown],
  );
  const [asyncResult, setAsyncResult] = useState<RenderResult>({
    html: null,
    error: null,
    source: null,
  });
  const rendererRef = useRef<WorkerRenderer | null>(null);
  const hasResultRef = useRef(false);

  useEffect(() => {
    if (!canUseWorker) return;
    const renderer = new WorkerRenderer();
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [canUseWorker]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    let cancelled = false;

    const run = () => {
      renderer
        .render(markdown)
        .then((html) => {
          if (cancelled) return;
          hasResultRef.current = true;
          setAsyncResult({ html, error: null, source: markdown });
        })
        .catch((err: unknown) => {
          if (cancelled || err === SUPERSEDED) return;
          if (err instanceof WorkerUnavailableError) {
            hasResultRef.current = true;
            setAsyncResult(renderOnMainThread(markdown));
            return;
          }
          // 직전 결과는 그대로 보여 주고 오류만 알린다
          setAsyncResult((previous) => ({
            html: previous.html,
            error: errorMessage(err),
            source: markdown,
          }));
        });
    };

    const timer = hasResultRef.current
      ? setTimeout(run, UPDATE_DEBOUNCE_MS)
      : null;
    if (timer === null) run();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [markdown]);

  const result = syncResult ?? asyncResult;
  return {
    html: result.html,
    error: result.error,
    isPending: result.source !== markdown,
  };
}
