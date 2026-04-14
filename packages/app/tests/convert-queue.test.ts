import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvertQueue } from "../src/lib/convert-queue";

interface QueueItem {
  readonly id: string;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ConvertQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("동시성 N으로 제한하여 최대 N개만 동시에 실행한다", async () => {
    const concurrency = 3;
    const inFlight = new Set<string>();
    let maxConcurrent = 0;
    const gates = new Map<string, ReturnType<typeof deferred<void>>>();
    const total = 10;
    let onIdleCalled = false;

    const queue = new ConvertQueue<QueueItem>({
      concurrency,
      run: async (item) => {
        inFlight.add(item.id);
        maxConcurrent = Math.max(maxConcurrent, inFlight.size);
        const gate = deferred<void>();
        gates.set(item.id, gate);
        await gate.promise;
        inFlight.delete(item.id);
      },
      onIdle: () => {
        onIdleCalled = true;
      },
    });

    for (let i = 0; i < total; i++) queue.enqueue({ id: `f${i}` });

    // 첫 N개 시작될 때까지 대기
    await vi.waitFor(() => expect(inFlight.size).toBe(concurrency));
    // 동시성 초과 금지 (drain 전 시점)
    expect(maxConcurrent).toBe(concurrency);

    // drain: 새로 시작되는 작업의 gate가 생기면 즉시 resolve
    let resolvedCount = 0;
    while (resolvedCount < total) {
      await vi.waitFor(() => expect(gates.size).toBeGreaterThan(resolvedCount));
      const id = `f${resolvedCount}`;
      gates.get(id)?.resolve();
      resolvedCount += 1;
    }

    await vi.waitFor(() => expect(onIdleCalled).toBe(true));
    expect(inFlight.size).toBe(0);
    expect(maxConcurrent).toBe(concurrency);
  });

  it("모든 작업 완료 시 onIdle 콜백을 호출한다", async () => {
    const onIdle = vi.fn();
    const queue = new ConvertQueue<QueueItem>({
      concurrency: 2,
      run: async () => {},
      onIdle,
    });

    queue.enqueue({ id: "a" });
    queue.enqueue({ id: "b" });

    await vi.waitFor(() => expect(onIdle).toHaveBeenCalledOnce());
  });

  it("진행 통계(running/pending/completed/failed)를 정확히 보고한다", async () => {
    const gate = deferred<void>();
    const states: Array<{
      running: number;
      pending: number;
      completed: number;
      failed: number;
    }> = [];

    const queue = new ConvertQueue<QueueItem>({
      concurrency: 2,
      run: async (item) => {
        if (item.id === "slow") await gate.promise;
      },
      onProgress: (snap) => states.push({ ...snap }),
    });

    queue.enqueue({ id: "a" });
    queue.enqueue({ id: "b" });
    queue.enqueue({ id: "slow" });
    queue.enqueue({ id: "c" });

    await vi.waitFor(() => expect(queue.snapshot().running).toBeGreaterThan(0));
    // a, b 완료 → slow 진행 중, c 진행 중 또는 대기
    await vi.waitFor(() => expect(queue.snapshot().completed).toBe(2));

    gate.resolve();
    await vi.waitFor(() => expect(queue.snapshot().completed).toBe(4));
    expect(queue.snapshot().pending).toBe(0);
    expect(queue.snapshot().running).toBe(0);
    expect(queue.snapshot().failed).toBe(0);
    expect(states.length).toBeGreaterThan(0);
  });

  it("개별 작업 실패는 다른 작업에 영향을 주지 않는다", async () => {
    const queue = new ConvertQueue<QueueItem>({
      concurrency: 2,
      run: async (item) => {
        if (item.id === "bad") throw new Error("boom");
      },
    });

    queue.enqueue({ id: "a" });
    queue.enqueue({ id: "bad" });
    queue.enqueue({ id: "c" });

    await vi.waitFor(() => expect(queue.snapshot().running).toBe(0));
    expect(queue.snapshot().completed).toBe(2);
    expect(queue.snapshot().failed).toBe(1);
  });

  it("cancelAll은 pending을 비우고 running은 끝까지 수행한다", async () => {
    const gate = deferred<void>();
    const completed: Array<string> = [];

    const queue = new ConvertQueue<QueueItem>({
      concurrency: 2,
      run: async (item) => {
        await gate.promise;
        completed.push(item.id);
      },
    });

    queue.enqueue({ id: "a" });
    queue.enqueue({ id: "b" });
    queue.enqueue({ id: "c" });
    queue.enqueue({ id: "d" });

    await vi.waitFor(() => expect(queue.snapshot().running).toBe(2));
    queue.cancelAll();
    expect(queue.snapshot().pending).toBe(0);

    gate.resolve();
    await vi.waitFor(() => expect(queue.snapshot().running).toBe(0));
    // 진행 중이던 a, b만 완료. c, d는 폐기
    expect(completed.sort()).toEqual(["a", "b"]);
  });

  it("cancelItem(id)로 pending 항목을 개별 제거한다", async () => {
    const gate = deferred<void>();
    const queue = new ConvertQueue<QueueItem>({
      concurrency: 1,
      run: async () => {
        await gate.promise;
      },
    });

    queue.enqueue({ id: "a" });
    queue.enqueue({ id: "b" });
    queue.enqueue({ id: "c" });

    await vi.waitFor(() => expect(queue.snapshot().running).toBe(1));
    queue.cancelItem("c");
    expect(queue.snapshot().pending).toBe(1); // 'b'만 남음

    gate.resolve();
    await vi.waitFor(() => expect(queue.snapshot().running).toBe(0));
    expect(queue.snapshot().completed).toBe(2);
  });

  it("running 중 cancelItem은 무시된다 (이미 시작되었으므로)", async () => {
    const gate = deferred<void>();
    const queue = new ConvertQueue<QueueItem>({
      concurrency: 1,
      run: async () => {
        await gate.promise;
      },
    });

    queue.enqueue({ id: "running" });
    await vi.waitFor(() => expect(queue.snapshot().running).toBe(1));

    queue.cancelItem("running"); // no-op
    expect(queue.snapshot().running).toBe(1);

    gate.resolve();
    await vi.waitFor(() => expect(queue.snapshot().completed).toBe(1));
  });
});
